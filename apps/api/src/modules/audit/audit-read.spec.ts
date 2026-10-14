import { AuditReadService } from './audit-read.service';

// Leitura PG de audit_events: pool mockado (sem banco).
// Convenção do mock: responde por conteúdo do SQL.

type Handler = (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] };

function mockPool(handler: Handler) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const q = async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    const out = handler(sql, params);
    return { rows: out.rows as never[], rowCount: 1 };
  };
  const pool = { query: q, connect: jest.fn(async () => ({ query: q, release: jest.fn() })) };
  return { pool, queries };
}

function eventRow(over: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    actorId: 'u-1',
    action: 'license.reveal',
    entity: 'license',
    entityId: 'lic-1',
    metadata: {},
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}

describe('AuditReadService.listEvents', () => {
  it('tabela vazia → { data: [], meta } honesto', async () => {
    const { pool } = mockPool(() => ({ rows: [] }));
    const svc = new AuditReadService(pool as never);
    await expect(svc.listEvents({})).resolves.toEqual({ data: [], meta: { nextCursor: null, limit: 20 } });
  });

  it('mapeia filtros p/ colunas reais (actor/resource/correlation_id/from/to)', async () => {
    const { pool, queries } = mockPool(() => ({ rows: [eventRow()] }));
    const svc = new AuditReadService(pool as never);
    const out = await svc.listEvents({
      actor: 'u-1',
      resource: 'license',
      correlationId: 'corr-1',
      from: '2026-10-01',
      to: '2026-10-31',
      limit: 10,
    });
    expect(out.data).toHaveLength(1);
    const sel = queries.find((x) => x.sql.includes('FROM audit_events') && x.sql.includes('ORDER BY'));
    expect(sel?.sql).toContain('"actorId" = $1');
    expect(sel?.sql).toContain('entity = $2');
    expect(sel?.sql).toContain(`metadata ->> 'correlationId' = $3`);
    expect(sel?.sql).toContain('"createdAt" >= $4');
    expect(sel?.sql).toContain('"createdAt" <= $5');
    expect(sel?.params).toEqual(['u-1', 'license', 'corr-1', '2026-10-01', '2026-10-31', 11]);
  });

  it('cursor = id opaco com keyset (createdAt,id); nunca offset; teto 100', async () => {
    const anchor = { createdAt: new Date('2026-10-02T00:00:00Z'), id: 'evt-9' };
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM audit_events WHERE id = $1')) return { rows: [anchor] };
      if (sql.includes('FROM audit_events')) return { rows: [eventRow({ id: 'evt-10' }), eventRow({ id: 'evt-11' })] };
      return { rows: [] };
    });
    const svc = new AuditReadService(pool as never);
    // Teto: limit 5000 é grampeado em 100 (sonda pede 101).
    const out = await svc.listEvents({ limit: 5000, cursor: 'evt-9' });
    expect(out.meta.limit).toBe(100);
    // 2 linhas p/ sonda de 101 → sem mais páginas: devolve as 2, sem cursor.
    expect(out.data).toHaveLength(2);
    expect(out.meta.nextCursor).toBeNull();
    const sel = queries.find((x) => x.sql.includes('ORDER BY'));
    expect(sel?.sql).toContain('(("createdAt", id) > (');
    expect(queries.some((x) => /\bOFFSET\b/i.test(x.sql))).toBe(false); // nunca offset
  });

  it('sonda limit+1: mais linhas que o limite corta e ancora o nextCursor', async () => {
    const anchor = { createdAt: new Date('2026-10-02T00:00:00Z'), id: 'evt-9' };
    const { pool } = mockPool((sql) => {
      if (sql.includes('FROM audit_events WHERE id = $1')) return { rows: [anchor] };
      if (sql.includes('FROM audit_events')) return { rows: [eventRow({ id: 'evt-10' }), eventRow({ id: 'evt-11' })] };
      return { rows: [] };
    });
    const svc = new AuditReadService(pool as never);
    const out = await svc.listEvents({ limit: 1, cursor: 'evt-9' });
    expect(out.data).toHaveLength(1);
    expect(out.meta).toEqual({ nextCursor: 'evt-10', limit: 1 });
  });

  it('404 não se aplica à lista; cursor desconhecido recomeça do início', async () => {
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM audit_events WHERE id = $1')) return { rows: [] }; // cursor ausente
      if (sql.includes('FROM audit_events')) return { rows: [eventRow()] };
      return { rows: [] };
    });
    const svc = new AuditReadService(pool as never);
    const out = await svc.listEvents({ cursor: 'evt-fantasma' });
    expect(out.data).toHaveLength(1);
    expect(out.meta.nextCursor).toBeNull();
    const sel = queries.find((x) => x.sql.includes('ORDER BY'));
    expect(sel?.sql).not.toContain('(("createdAt", id) > (');
  });
});
