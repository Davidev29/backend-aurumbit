import { CustomerPipelineService } from './customer-pipeline.service';
import type { Pool } from 'pg';

interface FakeQuery {
  sql: string;
  params?: unknown[];
}

function fakePool(rows: Array<Record<string, unknown>> = []): { pool: Pool; calls: FakeQuery[] } {
  const calls: FakeQuery[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (/INSERT INTO customers\.customer_profiles/i.test(sql)) {
        return { rows: [], rowCount: rows.length };
      }
      return { rows, rowCount: rows.length };
    },
  } as unknown as Pool;
  return { pool, calls };
}

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'prof-1',
  identityId: 'ident-1',
  name: '',
  email: 'cliente@aurum.test',
  stage: 'PROSPECT',
  emailVerified: false,
  registeredAt: '2026-10-17T10:00:00.000Z',
  stageChangedAt: '2026-10-17T10:00:00.000Z',
  ...over,
});

describe('CustomerPipelineService', () => {
  it('list() sincroniza a projeção ANTES de ler (cadastro novo aparece sem passo manual)', async () => {
    const { pool, calls } = fakePool([row()]);
    const svc = new CustomerPipelineService(pool);
    await svc.list();
    expect(calls[0]!.sql).toMatch(/INSERT INTO customers\.customer_profiles/i);
    expect(calls[1]!.sql).toMatch(/FROM customers\.customer_profiles p/i);
  });

  it('upsert é monotônico: PROSPECT→ACTIVE, mas nunca rebaixa estágio comercial', () => {
    // A regra está no próprio SQL (ON CONFLICT): garantimos por inspeção
    // explícita, já que o comportamento depende do Postgres.
    const { pool, calls } = fakePool();
    const svc = new CustomerPipelineService(pool);
    return svc.syncIdentities().then(() => {
      const sql = calls[0]!.sql;
      expect(sql).toMatch(/ON CONFLICT \(identity_id\) DO UPDATE SET/i);
      expect(sql).toMatch(/status = 'PROSPECT'[\s\S]*EXCLUDED\.status = 'ACTIVE'/i);
      // nenhum caminho rebaixa para PROSPECT fora do INSERT inicial
      const updateTail = sql.slice(sql.indexOf('DO UPDATE SET'));
      expect(updateTail).not.toMatch(/THEN 'PROSPECT'/i);
    });
  });

  it('mapeia linha: nome vazio cai para a parte local do e-mail', async () => {
    const { pool } = fakePool([row({ name: '' })]);
    const svc = new CustomerPipelineService(pool);
    const page = await svc.list();
    expect(page.data[0]!.name).toBe('cliente');
  });

  it('mapeia linha: nome preenchido é preservado', async () => {
    const { pool } = fakePool([row({ name: 'Maria Souza', stage: 'ACTIVE', emailVerified: true })]);
    const svc = new CustomerPipelineService(pool);
    const page = await svc.list();
    expect(page.data[0]!.name).toBe('Maria Souza');
    expect(page.data[0]!.stage).toBe('ACTIVE');
    expect(page.data[0]!.emailVerified).toBe(true);
  });

  it('cursor: devolve nextCursor só quando há página seguinte', async () => {
    const many = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
    const { pool } = fakePool(many);
    const svc = new CustomerPipelineService(pool);
    const page = await svc.list({ limit: 2 });
    expect(page.data).toHaveLength(2);
    expect(page.meta.nextCursor).toBe('b');
  });

  it('última página: nextCursor null', async () => {
    const { pool } = fakePool([row({ id: 'z' })]);
    const svc = new CustomerPipelineService(pool);
    const page = await svc.list({ limit: 20 });
    expect(page.meta.nextCursor).toBeNull();
  });

  it('filtros repassados: q, stage e cursor viram parâmetros do SQL', async () => {
    const { pool, calls } = fakePool([row()]);
    const svc = new CustomerPipelineService(pool);
    await svc.list({ q: ' maria ', stage: 'ACTIVE', cursor: 'prof-9', limit: 5 });
    const list = calls[1]!;
    expect(list.params).toEqual(['ACTIVE', 'maria', 'prof-9', 6]); // limit+1 (deteção de hasMore)
  });

  it('limit é limitado a 100 (no DoS de ?limit=999999)', async () => {
    const { pool, calls } = fakePool([row()]);
    const svc = new CustomerPipelineService(pool);
    await svc.list({ limit: 999_999 });
    expect(calls[1]!.params?.[3]).toBe(101);
  });

  it('countByStage: zeros para estágios ausentes (cards não ficam undefined)', async () => {
    const { pool } = fakePool([
      { stage: 'PROSPECT', n: '2' },
      { stage: 'ACTIVE', n: '5' },
    ]);
    const svc = new CustomerPipelineService(pool);
    const counts = await svc.countByStage();
    expect(counts).toEqual({ PROSPECT: 2, PENDING_PAYMENT: 0, ACTIVE: 5, SUSPENDED: 0, CANCELLED: 0 });
  });
});