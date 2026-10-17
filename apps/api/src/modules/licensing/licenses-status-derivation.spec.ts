import { ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { GRACE_MS, effectiveStatus } from './license-keys';
import {
  LICENSE_HISTORY_TYPES,
  LICENSE_OUTBOX_TYPES,
  LicenseRow,
  LicensesService,
  statusSqlPredicate,
} from './licenses.service';

// ---------------------------------------------------------------------------
// Regressão do bug reportado: "modal de visualização de um produto criado:
// onde atualmente não está refletindo chaves vencidas ou defasadas".
//
// D1 — `licenseHistory` tirava o status do TIPO DO EVENTO, nunca do relógio:
//       uma licença com `expiresAt` no passado voltava 'active' (verde).
// D2 — o retorno não tinha `expiresAt`/`graceUntil`/`kind` (UI sem hora).
// D4 — o histórico só concatenava eventos; nunca lia a linha da licença.
// D5 — `SELECT_COLS` omitia `maxDevices`.
// ---------------------------------------------------------------------------

const REAL_LICENSE_ID = '0b5878f2-365c-49b6-9916-0409e9f20686';
// Row real do banco docker `aurumbit` (lido em 2026-10-17 19:09Z).
const REAL_EXPIRES_AT = new Date('2026-10-17T00:18:27.271Z');

type Handler = (sql: string, params: unknown[]) => { rows?: unknown[]; rowCount?: number };

/** Pool `pg` falso no padrão do repo (products-machines.spec.ts): mock só `query`. */
function fakePool(handler: Handler) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const run = async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params: params ?? [] });
    return handler(sql, params ?? []);
  };
  const query = jest.fn(run);
  const client = { query: jest.fn(run), release: jest.fn() };
  const pool = { query, connect: jest.fn(async () => client) } as unknown as Pool;
  return { pool, client, calls, sqlOf: (re: RegExp) => calls.find((c) => re.test(c.sql)) };
}

function mkRow(over: Partial<LicenseRow> = {}): LicenseRow {
  const issued = new Date('2026-10-16T18:18:27.271Z');
  return {
    id: REAL_LICENSE_ID,
    ownerType: 'PROMO',
    ownerId: 'promo:b38c083c',
    ownerLabel: 'TESTE',
    productId: 'aurum_tax_ncm',
    planId: null,
    contractItemId: null,
    kind: 'trial',
    status: 'active',
    key_hash: 'deadbeef'.repeat(8),
    key_prefix: 'ABCD',
    key_last4: 'WXYZ',
    key_enc: 'v2.1.a.b.c.d',
    tokenVersion: 1,
    maxDevices: 3,
    issuedAt: issued,
    startsAt: issued,
    expiresAt: REAL_EXPIRES_AT,
    graceUntil: REAL_EXPIRES_AT,
    features: [{ code: 'F1', channel: 'WEB' }],
    createdAt: issued,
    updatedAt: issued,
    ...over,
  };
}

/** Handler: 1ª query = loadRow, 2ª = outbox do histórico. */
function historyPool(row: LicenseRow, events: Array<{ type: string; payload?: unknown; occurredAt: string }>) {
  return fakePool((sql) => {
    if (/FROM outbox_events/.test(sql)) {
      return { rows: events.map((e) => ({ type: e.type, payload: e.payload ?? {}, occurredAt: new Date(e.occurredAt) })) };
    }
    return { rows: [row] };
  });
}

const NOW_AFTER_EXPIRY = new Date('2026-10-17T19:09:03.690Z'); // ~18h51m após o vencimento

describe('D1 — licenseHistory deriva o status do RELÓGIO, não do tipo do evento', () => {
  it('licença expirada (expiresAt no passado) devolve status "expired" — não "active"', async () => {
    // Row REAL: expiresAt = 2026-10-17T00:18:27.271Z, status cru 'active'.
    const { pool } = historyPool(mkRow(), [
      { type: 'LicenseIssued', occurredAt: '2026-10-16T18:18:27.272Z' },
    ]);
    const entries = await new LicensesService(pool).licenseHistory(REAL_LICENSE_ID, NOW_AFTER_EXPIRY);

    expect(entries).toHaveLength(1);
    // ESTE é o assert que reprova o bug D1.
    expect(entries[0].status).toBe('expired');
    expect(entries[0].status).not.toBe('active');
    // E o motivo fica auditável (cru vs derivado), não escondido.
    expect(entries[0].rawStatus).toBe('active');
    expect(entries[0].derivedFromClock).toBe(true);
    expect(entries[0].currentStatus).toBe('expired');
  });

  it('mesma licença lida ANTES do vencimento continua "active" (relógio, não evento)', async () => {
    const { pool } = historyPool(mkRow(), [
      { type: 'LicenseIssued', occurredAt: '2026-10-16T18:18:27.272Z' },
    ]);
    const before = new Date('2026-10-17T00:00:00.000Z');
    const entries = await new LicensesService(pool).licenseHistory(REAL_LICENSE_ID, before);
    expect(entries[0].status).toBe('active');
    expect(entries[0].derivedFromClock).toBe(false);
  });

  it('revogada continua "revoked" e encerrada-por-troca vira "replaced" (rótulos do front)', async () => {
    const { pool } = historyPool(mkRow({ status: 'revoked' }), [
      { type: 'LicenseIssued', occurredAt: '2026-10-10T10:00:00.000Z' },
      { type: 'LicenseRevoked', payload: { reason: 'cancelamento', replacedBy: 'lic-nova' }, occurredAt: '2026-10-11T10:00:00.000Z' },
    ]);
    const entries = await new LicensesService(pool).licenseHistory(REAL_LICENSE_ID, NOW_AFTER_EXPIRY);
    expect(entries.map((e) => e.status)).toEqual(['expired', 'replaced']);
    const rev = entries[1];
    expect(rev.replacedBy).toBe('lic-nova');
    expect(rev.reason).toBe('cancelamento');
    expect(rev.endedAt).toBe('2026-10-11T10:00:00.000Z');
    expect(rev.current).toBe(true);

    // Revogação SEM sucessora = 'revoked' ("Revogada" no front).
    const { pool: p2 } = historyPool(mkRow({ status: 'revoked' }), [
      { type: 'LicenseRevoked', payload: { reason: 'fraude' }, occurredAt: '2026-10-11T10:00:00.000Z' },
    ]);
    const e2 = await new LicensesService(p2).licenseHistory(REAL_LICENSE_ID, NOW_AFTER_EXPIRY);
    expect(e2[0].status).toBe('revoked');
  });

  it('suspensa continua "suspended" (terminal vence o relógio, como em effectiveStatus)', async () => {
    const { pool } = historyPool(mkRow({ status: 'suspended' }), [
      { type: 'LicenseSuspended', payload: { reason: 'inadimplencia' }, occurredAt: '2026-10-11T10:00:00.000Z' },
    ]);
    const entries = await new LicensesService(pool).licenseHistory(REAL_LICENSE_ID, NOW_AFTER_EXPIRY);
    expect(entries[0].status).toBe('suspended');
  });

  it('eventos de outbox cobrem reativação e prorrogação (não ficaram invisíveis)', async () => {
    const { pool, sqlOf } = historyPool(mkRow(), [
      { type: 'LicenseIssued', occurredAt: '2026-10-01T10:00:00.000Z' },
      { type: 'LicenseSuspended', occurredAt: '2026-10-05T10:00:00.000Z' },
      { type: 'LicenseResumed', occurredAt: '2026-10-06T10:00:00.000Z' },
      { type: 'LicenseExtended', occurredAt: '2026-10-07T10:00:00.000Z' },
    ]);
    const entries = await new LicensesService(pool).licenseHistory(REAL_LICENSE_ID, NOW_AFTER_EXPIRY);
    const q = sqlOf(/FROM outbox_events/)!;
    for (const t of LICENSE_HISTORY_TYPES) expect(q.sql).toContain(`'${t}'`);
    expect(LICENSE_OUTBOX_TYPES).toEqual(expect.arrayContaining(['LicenseExtended', 'LicenseResumed']));

    expect(entries.map((e) => e.eventType)).toEqual([
      'LicenseIssued',
      'LicenseSuspended',
      'LicenseResumed',
      'LicenseExtended',
    ]);
    expect(entries[entries.length - 1].current).toBe(true);
    expect(entries.filter((e) => e.current)).toHaveLength(1);
  });

  it('sem evento algum: sintetiza a partir da linha (D4 — nunca devolve vazio p/ licença real)', async () => {
    const { pool } = historyPool(mkRow(), []);
    const entries = await new LicensesService(pool).licenseHistory(REAL_LICENSE_ID, NOW_AFTER_EXPIRY);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: 'expired', eventType: 'LicenseState', current: true });
  });
});

describe('D2 — licenseHistory carrega as datas com HORA + modalidade + origem', () => {
  it('devolve expiresAt/graceUntil/startsAt/kind/ownerLabel/productId', async () => {
    const { pool } = historyPool(mkRow(), [
      { type: 'LicenseIssued', occurredAt: '2026-10-16T18:18:27.272Z' },
    ]);
    const [e] = await new LicensesService(pool).licenseHistory(REAL_LICENSE_ID, NOW_AFTER_EXPIRY);

    // ISO-8601 completo: a UI formata com HORA, não só dia.
    expect(e.expiresAt).toBe('2026-10-17T00:18:27.271Z');
    expect(e.graceUntil).toBe('2026-10-17T00:18:27.271Z');
    expect(e.startsAt).toBe('2026-10-16T18:18:27.271Z');
    expect(e.kind).toBe('trial');
    expect(e.ownerLabel).toBe('TESTE');
    expect(e.ownerType).toBe('PROMO');
    expect(e.productId).toBe('aurum_tax_ncm');
    expect(e.keyMasked).toBe('AURUM-••••-••••-WXYZ');
    expect(e.occurredAt).toBe('2026-10-16T18:18:27.272Z');
  });

  it('campos originais do contrato com o BFF admin continuam presentes', async () => {
    const { pool } = historyPool(mkRow(), [{ type: 'LicenseIssued', occurredAt: '2026-10-16T18:18:27.272Z' }]);
    const [e] = await new LicensesService(pool).licenseHistory(REAL_LICENSE_ID, NOW_AFTER_EXPIRY);
    for (const k of ['licenseId', 'keyMasked', 'status', 'reason', 'endedAt', 'replacedBy']) {
      expect(Object.keys(e)).toContain(k);
    }
    expect(e.licenseId).toBe(REAL_LICENSE_ID);
  });

  it('vitalícia devolve expiresAt/graceUntil null (UI mostra "sem expiração")', async () => {
    const { pool } = historyPool(mkRow({ kind: 'lifetime', expiresAt: null, graceUntil: null }), [
      { type: 'LicenseIssued', occurredAt: '2026-10-16T18:18:27.272Z' },
    ]);
    const [e] = await new LicensesService(pool).licenseHistory(REAL_LICENSE_ID, NOW_AFTER_EXPIRY);
    expect(e.expiresAt).toBeNull();
    expect(e.graceUntil).toBeNull();
    expect(e.kind).toBe('lifetime');
    expect(e.status).toBe('active');
  });
});

describe('effectiveStatus — fronteira (exatamente expiresAt / graceUntil)', () => {
  const base = { status: 'active', expiresAt: REAL_EXPIRES_AT, graceUntil: null as Date | null };
  it('exatamente expiresAt → "active" (boundary inclusiva)', () => {
    expect(effectiveStatus(base, REAL_EXPIRES_AT)).toBe('active');
  });
  it('1ms depois de expiresAt sem graça → "expired"', () => {
    expect(effectiveStatus(base, new Date(REAL_EXPIRES_AT.getTime() + 1))).toBe('expired');
  });
  it('exatamente graceUntil → "grace"', () => {
    const g = new Date(REAL_EXPIRES_AT.getTime() + 60_000);
    const row = { status: 'active', expiresAt: REAL_EXPIRES_AT, graceUntil: g };
    expect(effectiveStatus(row, g)).toBe('grace');
  });
  it('1ms depois de graceUntil → "expired"', () => {
    const g = new Date(REAL_EXPIRES_AT.getTime() + 60_000);
    const row = { status: 'active', expiresAt: REAL_EXPIRES_AT, graceUntil: g };
    expect(effectiveStatus(row, new Date(g.getTime() + 1))).toBe('expired');
  });
  it('terminais nunca regridem por tempo', () => {
    for (const s of ['suspended', 'revoked', 'pending_payment'] as const) {
      expect(effectiveStatus({ status: s, expiresAt: REAL_EXPIRES_AT, graceUntil: REAL_EXPIRES_AT }, NOW_AFTER_EXPIRY)).toBe(s);
    }
  });
});

describe('D5 — SELECT_COLS inclui maxDevices', () => {
  it('select traz "maxDevices" e a resposta mascarada carrega o limite de máquinas', async () => {
    const { pool, sqlOf } = fakePool(() => ({ rows: [mkRow()] }));
    const lic = await new LicensesService(pool).getLicense(REAL_LICENSE_ID);
    expect(sqlOf(/FROM licenses/)!.sql).toContain('"maxDevices"');
    expect(lic.maxDevices).toBe(3);
    // e continua sem vazar segredo
    expect((lic as Record<string, unknown>).key_hash).toBeUndefined();
    expect((lic as Record<string, unknown>).key_enc).toBeUndefined();
  });
});

describe('POST /v1/licenses/:id/extend — prorrogação in-place', () => {
  const ACTIVE_NOW = new Date('2026-10-16T20:00:00.000Z');

  function extendPool(prev: LicenseRow, next: LicenseRow = prev) {
    return fakePool((sql) => {
      // loadRow (SELECT sem RETURNING) → antes; UPDATE ... RETURNING → depois.
      if (/UPDATE licenses/.test(sql)) return { rows: [next] };
      if (/FROM licenses WHERE id/.test(sql)) return { rows: [prev] };
      return { rows: [] };
    });
  }

  it('prorroga na MESMA licença: preserva id, key_hash e vínculos (não cria chave nova)', async () => {
    const prev = mkRow({ kind: 'monthly', expiresAt: new Date('2026-11-16T20:00:00.000Z'), graceUntil: new Date('2026-11-19T20:00:00.000Z') });
    const next = mkRow({
      kind: 'monthly',
      expiresAt: new Date('2026-12-16T20:00:00.000Z'),
      graceUntil: new Date('2026-12-19T20:00:00.000Z'),
    });
    const { pool, calls } = extendPool(prev, next);
    const svc = new LicensesService(pool);
    const out = await svc.extendLicense(REAL_LICENSE_ID, 1, 'cortesia de suporte anual', 'admin:1', ACTIVE_NOW);

    expect(out.license.id).toBe(prev.id); // mesma licença
    expect(out.license.keyMasked).toBe('AURUM-••••-••••-WXYZ'); // mesma chave
    expect(out.previousExpiresAt).toBe('2026-11-16T20:00:00.000Z');
    expect(out.license.expiresAt).toEqual(new Date('2026-12-16T20:00:00.000Z'));
    // graceUntil = expiresAt + 3d (GRACE_MS)
    expect(out.license.graceUntil).toEqual(new Date(out.license.expiresAt!.getTime() + GRACE_MS));

    const upd = calls.find((c) => /UPDATE licenses/.test(c.sql))!;
    // NÃO toca id, key_hash nem key_enc — a chave do cliente continua válida.
    expect(upd.sql).not.toMatch(/key_hash\s*=/);
    expect(upd.sql).not.toMatch(/key_enc\s*=/);
    expect(upd.sql).toMatch(/"expiresAt" = \$2/);
    expect(upd.sql).toMatch(/"graceUntil" = \$3/);
  });

  it('NÃO bumps tokenVersion (decisão: prorrogar soma direito, não tira)', async () => {
    const { pool, calls } = extendPool(mkRow({ kind: 'monthly' }), mkRow({ kind: 'monthly' }));
    const out = await new LicensesService(pool).extendLicense(
      REAL_LICENSE_ID, 3, 'renegociado com o cliente', 'admin:1', ACTIVE_NOW,
    );
    const upd = calls.find((c) => /UPDATE licenses/.test(c.sql))!;
    // O SET não mexe em tokenVersion (aparece só no RETURNING de SELECT_COLS).
    expect(upd.sql).not.toMatch(/"tokenVersion"\s*=/);
    expect(out.license.tokenVersion).toBe(1); // inalterado
    const ob = calls.find((c) => /INSERT INTO outbox_events/.test(c.sql))!;
    expect(JSON.parse(String(ob.params[4]))).toMatchObject({ tokenVersion: 1, months: 3 });
  });

  it('licença JÁ EXPIRADA pode ser prorrogada (caso de uso do bug) — conta de agora', async () => {
    const prev = mkRow({ kind: 'monthly', expiresAt: REAL_EXPIRES_AT, graceUntil: REAL_EXPIRES_AT });
    const next = mkRow({ kind: 'monthly', expiresAt: new Date('2026-11-17T19:09:03.690Z'), graceUntil: new Date('2026-11-20T19:09:03.690Z') });
    const { pool } = extendPool(prev, next);
    const out = await new LicensesService(pool).extendLicense(
      REAL_LICENSE_ID, 1, 'reemissao de chave vencida', 'admin:1', NOW_AFTER_EXPIRY,
    );
    expect(out.license.status).toBe('active'); // volta a valer na mesma chave
    expect(out.license.id).toBe(REAL_LICENSE_ID);
  });

  it('prorrogar dentro da graça continua do vencimento anterior (sem buraco)', async () => {
    const prev = mkRow({ kind: 'monthly', expiresAt: new Date('2026-10-20T00:00:00.000Z') });
    const next = mkRow({ kind: 'monthly', expiresAt: new Date('2026-11-20T00:00:00.000Z') });
    const { pool } = extendPool(prev, next);
    const out = await new LicensesService(pool).extendLicense(
      REAL_LICENSE_ID, 1, 'prorrogado durante a janela de graca', 'admin:1',
      new Date('2026-10-18T00:00:00.000Z'),
    );
    expect(out.license.expiresAt).toEqual(new Date('2026-11-20T00:00:00.000Z'));
  });

  it('409 em revoked (terminal)', async () => {
    const { pool, calls } = extendPool(mkRow({ status: 'revoked' }));
    await expect(
      new LicensesService(pool).extendLicense(REAL_LICENSE_ID, 1, 'tentativa indevida', 'admin:1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(calls.some((c) => /UPDATE licenses/.test(c.sql))).toBe(false);
  });

  it('409 em lifetime (sem expiresAt) com código claro', async () => {
    const { pool } = extendPool(mkRow({ kind: 'lifetime', expiresAt: null, graceUntil: null }));
    await expect(
      new LicensesService(pool).extendLicense(REAL_LICENSE_ID, 1, 'tentativa em vitalicia', 'admin:1'),
    ).rejects.toMatchObject({ response: { code: 'LIFETIME_NO_EXTEND' } });
  });

  it('409 em pending_payment e 400 fora de 1..12 meses', async () => {
    const { pool: p1 } = extendPool(mkRow({ status: 'pending_payment' }));
    await expect(
      new LicensesService(p1).extendLicense(REAL_LICENSE_ID, 1, 'antes de pagar', 'admin:1'),
    ).rejects.toMatchObject({ response: { code: 'PENDING_NO_EXTEND' } });

    const { pool: p2 } = extendPool(mkRow());
    const svc = new LicensesService(p2);
    for (const bad of [0, 13, 1.5]) {
      await expect(svc.extendLicense(REAL_LICENSE_ID, bad, 'meses invalidos', 'admin:1')).rejects.toThrow();
    }
  });

  it('UPDATE e outbox LicenseExtended na MESMA transação (prorrogação sem trilha = buraco)', async () => {
    const { pool, client } = extendPool(mkRow());
    await new LicensesService(pool).extendLicense(REAL_LICENSE_ID, 1, 'auditado no outbox', 'admin:7');
    const seq = client.query.mock.calls.map((c) => String(c[0]));
    expect(seq[0]).toBe('BEGIN');
    expect(seq.some((s) => /UPDATE licenses/.test(s))).toBe(true);
    expect(seq).toContain('COMMIT');
    const ob = client.query.mock.calls.find((c) => /INSERT INTO outbox_events/.test(String(c[0])))!;
    const obArgs = (ob[1] ?? []) as unknown[];
    const payload = JSON.parse(String(obArgs[4])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      licenseId: REAL_LICENSE_ID, months: 1, reason: 'auditado no outbox', actor: 'admin:7',
    });
    expect(payload.previousExpiresAt).toBe(REAL_EXPIRES_AT.toISOString());
    expect(client.release).toHaveBeenCalled();
  });

  it('trial não herda graça extra (graceUntil = expiresAt, como calcExpiry)', async () => {
    const { pool, calls } = extendPool(mkRow({ kind: 'trial' }));
    await new LicensesService(pool).extendLicense(REAL_LICENSE_ID, 1, 'demo prorrogada', 'admin:1');
    const upd = calls.find((c) => /UPDATE licenses/.test(c.sql))!;
    expect(upd.params[2]).toBe(upd.params[1]); // $2 (expiresAt) === $3 (graceUntil)
  });
});

describe('resumeLicense emite outbox LicenseResumed (reativação visível no histórico)', () => {
  it('grava status active + insere LicenseResumed na mesma transação', async () => {
    const suspended = mkRow({ status: 'suspended' });
    const resumed = mkRow({
      status: 'active',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      graceUntil: new Date('2027-01-04T00:00:00.000Z'),
    });
    const { pool, client } = fakePool((sql) => {
      if (/UPDATE licenses/.test(sql)) return { rows: [resumed] };
      if (/FROM licenses WHERE id/.test(sql)) return { rows: [suspended] };
      return { rows: [] };
    });
    const out = await new LicensesService(pool).resumeLicense(REAL_LICENSE_ID, 'cliente quitou o debito', 'admin:1');
    expect(out.status).toBe('active');

    const seq = client.query.mock.calls.map((c) => String(c[0]));
    expect(seq[0]).toBe('BEGIN');
    expect(seq.some((s) => s.includes("status = 'active'"))).toBe(true);
    const ob = client.query.mock.calls.find((c) => /INSERT INTO outbox_events/.test(String(c[0])))!;
    const obArgs = (ob[1] ?? []) as unknown[];
    expect(obArgs[3]).toBe('LicenseResumed'); // 4º param = type
    expect(JSON.parse(String(obArgs[4]))).toMatchObject({ reason: 'cliente quitou o debito', actor: 'admin:1' });
  });
});

describe('GET /v1/products/:code/licenses — listagem com status efetivo', () => {
  const rows = [
    mkRow({ id: 'l-exp', status: 'active', expiresAt: REAL_EXPIRES_AT, graceUntil: REAL_EXPIRES_AT }),
    mkRow({ id: 'l-ok', status: 'active', expiresAt: new Date('2027-01-01T00:00:00.000Z') }),
    mkRow({ id: 'l-rev', status: 'revoked' }),
  ];

  function listPool() {
    return fakePool((sql) => (sql.startsWith('SELECT count(*)') ? { rows: [{ n: rows.length }] } : { rows }));
  }

  it('sem filtro devolve todas com status DERIVADO + paginação', async () => {
    const { pool, sqlOf } = listPool();
    const out = await new LicensesService(pool).listProductLicenses('aurum_tax_ncm', { limit: 10 }, NOW_AFTER_EXPIRY);
    expect(out.total).toBe(3);
    expect(out.items.map((i) => [i.id, i.status])).toEqual([
      ['l-exp', 'expired'],
      ['l-ok', 'active'],
      ['l-rev', 'revoked'],
    ]);
    const sel = sqlOf(/LIMIT/)!.sql;
    expect(sel).toContain('"maxDevices"');
    expect(sel).toContain('LIMIT $2 OFFSET $3');
    expect((out.items[0] as Record<string, unknown>).key_hash).toBeUndefined();
  });

  it('filtro de status vai AO SQL (não em memória pós-LIMIT: página mentirosa)', async () => {
    const { pool, sqlOf } = listPool();
    const out = await new LicensesService(pool).listProductLicenses(
      'aurum_tax_ncm', { status: 'expired' }, NOW_AFTER_EXPIRY,
    );
    const where = sqlOf(/SELECT count/)!.sql;
    expect(where).toContain(`"expiresAt" < $2`);
    expect(where).toContain(`"graceUntil" < $2`);
    expect(where).toContain(`status = 'active'`);
    // Portão final em JS: nada sai com status ≠ pedido.
    expect(out.items.every((i) => i.status === 'expired')).toBe(true);
  });
});

describe('statusSqlPredicate — status persistido vs derivado', () => {
  const now = '2026-10-17T19:09:03.690Z';
  it.each([
    ['pending_payment', `status = 'pending_payment'`],
    ['suspended', `status = 'suspended'`],
    ['revoked', `status = 'revoked'`],
  ])('persistido %s → igualdade exata', (status, want) => {
    expect(statusSqlPredicate(status, now)).toBe(want);
  });

  it('active = cru active E não vencido (vitalícia inclusa), boundary inclusiva', () => {
    const p = statusSqlPredicate('active', '$1');
    expect(p).toContain(`status = 'active'`);
    expect(p).toContain(`"expiresAt" IS NULL OR "expiresAt" >= $1`);
  });

  it('grace = venceu mas dentro da janela (boundary inclusiva)', () => {
    const p = statusSqlPredicate('grace', '$1');
    expect(p).toContain(`"expiresAt" < $1`);
    expect(p).toContain(`"graceUntil" >= $1`);
  });

  it('expired = venceu E sem graça (ou graça vencida)', () => {
    const p = statusSqlPredicate('expired', '$1');
    expect(p).toContain(`"expiresAt" < $1`);
    expect(p).toContain(`"graceUntil" IS NULL OR "graceUntil" < $1`);
  });

  it('status desconhecido → 400 (não vira SQL silencioso)', () => {
    expect(() => statusSqlPredicate('ACTIVE', now)).toThrow();
    expect(() => statusSqlPredicate("' OR 1=1", now)).toThrow();
  });
});
