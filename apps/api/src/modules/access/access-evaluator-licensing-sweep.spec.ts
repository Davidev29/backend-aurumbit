import { Pool } from 'pg';
import { AccessEvaluatorService } from './access-evaluator.service';

// Coluna real do sweep. Dois bugs o deixavam sempre `skipped` desde a Fase 3:
//  1) a probe pedia `expires_at`/`grace_until` (SNAKE_CASE) — as colunas são
//     camelCase (`prisma/licensing/schema.prisma:35-36`) → cols=0;
//  2) o UPDATE comparava `status = 'ACTIVE'` — o valor persistido é
//     `'active'` (minúsculo, gravado por `issueLicense`).
// A probe é mockada com as MESMAS linhas que o PG devolveria
// (information_schema.columns) — testar contra o mock é explícito aqui.

const LICENSING_COLUMNS = [
  { column_name: 'expiresAt' },
  { column_name: 'graceUntil' },
];

type Call = { sql: string; params: unknown[] };

function sweepPool(opts: {
  columns?: Array<{ column_name: string }>;
  expired?: number;
  probeThrows?: boolean;
  sweepThrows?: boolean;
}) {
  const calls: Call[] = [];
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params: params ?? [] });
    if (/information_schema/.test(sql)) {
      if (opts.probeThrows) throw new Error('probe boom');
      return { rows: opts.columns ?? LICENSING_COLUMNS };
    }
    // Varredura (o detector): conta as vencidas além da graça.
    if (/SELECT count\(\*\)/.test(sql) || /UPDATE licenses/.test(sql)) {
      if (opts.sweepThrows) throw new Error('sweep boom');
      return { rows: [{ n: opts.expired ?? 0 }], rowCount: opts.expired ?? 0 };
    }
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, query, calls };
}

const NOW = new Date('2026-10-17T19:09:03.690Z');

describe('evaluateLicenses — probe com os nomes REAIS das colunas', () => {
  it('encontra expiresAt/graceUntil (camelCase) e NÃO usa os nomes snake_case', async () => {
    const { pool, calls } = sweepPool({ expired: 1 });
    const out = await new AccessEvaluatorService({} as never, pool).evaluateLicenses(NOW);

    expect(out.skipped).toBe(false);
    expect(out.toExpired).toBe(1);

    const probe = calls.find((c) => /information_schema/.test(c.sql))!;
    expect(probe.sql).toContain(`column_name IN ('expiresAt', 'graceUntil')`);
    expect(probe.sql).not.toContain('expires_at');
    expect(probe.sql).not.toContain('grace_until');
    // Schema explícito: `information_schema` é por schema visível.
    expect(probe.sql).toContain('table_schema = $1');
    expect(probe.params).toEqual(['licensing']);
  });

  it('stub Fase 1 (só colunas snake_case) → skipped, com motivo claro', async () => {
    const { pool } = sweepPool({ columns: [{ column_name: 'expires_at' }, { column_name: 'grace_until' }] });
    const out = await new AccessEvaluatorService({} as never, pool).evaluateLicenses(NOW);
    expect(out).toMatchObject({ skipped: true, toExpired: 0 });
    expect(out.reason).toMatch(/camelCase/);
  });

  it('contar 2 não basta: as DUAS colunas certainas precisam existir', async () => {
    // expiresAt + expires_at = 2 colunas, mas graceUntil (a que importa) não.
    const { pool } = sweepPool({ columns: [{ column_name: 'expiresAt' }, { column_name: 'expires_at' }] });
    const out = await new AccessEvaluatorService({} as never, pool).evaluateLicenses(NOW);
    expect(out.skipped).toBe(true);
  });

  it('sem licensingPool → skipped sem tocar o banco', async () => {
    const svc = new AccessEvaluatorService({} as never, undefined);
    const out = await svc.evaluateLicenses(NOW);
    expect(out).toMatchObject({ skipped: true, toExpired: 0, reason: 'sem licensingPool' });
  });

  it('probe que estoura → skipped, sem UPDATE', async () => {
    const { pool, calls } = sweepPool({ probeThrows: true });
    const out = await new AccessEvaluatorService({} as never, pool).evaluateLicenses(NOW);
    expect(out).toMatchObject({ skipped: true, reason: 'probe information_schema falhou' });
    expect(calls.some((c) => /UPDATE licenses/.test(c.sql))).toBe(false);
  });
});

describe('evaluateLicenses — comparação de status com o valor REAL persistido', () => {
  it('usa status = \'active\' (minúsculo) e os identificadores camelCase', async () => {
    const { pool, calls } = sweepPool({ expired: 2 });
    await new AccessEvaluatorService({} as never, pool).evaluateLicenses(NOW);

    const sweep = calls.find((c) => /FROM licenses/.test(c.sql) && !/information_schema/.test(c.sql))!;
    expect(sweep.sql).toContain(`status = 'active'`);
    expect(sweep.sql).not.toContain(`status = 'ACTIVE'`);
    expect(sweep.sql).toContain(`"expiresAt" < $1`);
    expect(sweep.sql).toContain(`"graceUntil" IS NULL OR "graceUntil" < $1`);
    expect(sweep.params).toEqual([NOW.toISOString()]);
  });

  it('NÃO grava status derivado em `status` (coluna é o lifecycle CRU)', async () => {
    // Escrever 'expired' quebraria os gates que testam o status CRU:
    // offline-token.service.ts:58 e devices.service.ts:267/:525 cairiam em
    // LICENSE_INACTIVE antes do check de datas (mensagem errada).
    const { pool, calls } = sweepPool({ expired: 1 });
    await new AccessEvaluatorService({} as never, pool).evaluateLicenses(NOW);
    for (const c of calls) {
      expect(c.sql).not.toMatch(/UPDATE\s+licenses/i);
      expect(c.sql).not.toContain(`status = 'EXPIRED'`);
      expect(c.sql).not.toContain(`status = 'expired'`);
    }
  });

  it('o sweep é detector: conta o que está vencido além da graça', async () => {
    const { pool } = sweepPool({ expired: 7 });
    const out = await new AccessEvaluatorService({} as never, pool).evaluateLicenses(NOW);
    expect(out).toEqual({ evaluatedAt: NOW.toISOString(), skipped: false, toExpired: 7 });
  });

  it('sweep que estoura → skipped com motivo, sem propagar', async () => {
    const { pool } = sweepPool({ sweepThrows: true });
    const out = await new AccessEvaluatorService({} as never, pool).evaluateLicenses(NOW);
    expect(out).toMatchObject({ skipped: true, toExpired: 0 });
    expect(out.reason).toMatch(/sweep licensing falhou/);
  });

  it('FROM licenses sem prefixo de schema (search_path do role já é licensing)', async () => {
    const { pool, calls } = sweepPool({ expired: 0 });
    await new AccessEvaluatorService({} as never, pool).evaluateLicenses(NOW);
    const sweep = calls.find((c) => /FROM licenses/.test(c.sql) && !/information_schema/.test(c.sql))!;
    expect(sweep.sql).toContain('FROM licenses');
    expect(sweep.sql).not.toContain('FROM licensing.licenses');
  });
});
