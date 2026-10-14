import { NotFoundException } from '@nestjs/common';
import { BillingService } from './billing.service';

// Leituras paginadas do Billing (aditivo): pool PG mockado (sem banco).
// Convenção do mock: responde por prefixo/conteúdo do SQL
// (mesmo padrão de billing.service.spec.ts).

type Handler = (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] };

function mockPool(handler: Handler) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const q = async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    const out = handler(sql, params);
    return { rows: out.rows as never[], rowCount: 1 };
  };
  const client = { query: q, release: jest.fn() };
  const pool = { query: q, connect: jest.fn(async () => client) };
  return { pool, queries };
}

function invoiceRow(over: Record<string, unknown> = {}, i = 0) {
  return {
    id: `inv-${i}`,
    number: `INV-2026-00000${i}`,
    customerId: 'cust-1',
    subscriptionId: null,
    orderId: null,
    asaasInvoiceId: null,
    status: 'DRAFT',
    amountCents: 1000,
    discountCents: 0,
    fineCents: 0,
    interestCents: 0,
    dueDate: new Date('2026-11-10T00:00:00Z'),
    paidAt: null,
    idempotencyKey: `inv-key-${i}`,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}

function subRow(over: Record<string, unknown> = {}, i = 0) {
  return {
    id: `sub-${i}`,
    customerId: 'cust-1',
    asaasSubscriptionId: null,
    status: 'DRAFT',
    planRef: null,
    idempotencyKey: `sub-key-${i}`,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    canceledAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}

describe('BillingService.listInvoices', () => {
  it('lista vazia → { data: [], meta: { nextCursor: null, limit } }', async () => {
    const { pool, queries } = mockPool(() => ({ rows: [] }));
    const svc = new BillingService(pool as never);
    const out = await svc.listInvoices({});
    expect(out).toEqual({ data: [], meta: { nextCursor: null, limit: 20 } });
    const sel = queries.find((x) => x.sql.includes('FROM invoices'));
    expect(sel?.sql).toContain('ORDER BY "createdAt", id');
    expect(sel?.params?.[sel.params.length - 1]).toBe(21); // limit+1 (sonda de próxima página)
  });

  it('aplica filtros status + due_from/due_to como params (sem dump sem limite)', async () => {
    const { pool, queries } = mockPool(() => ({ rows: [invoiceRow()] }));
    const svc = new BillingService(pool as never);
    const out = await svc.listInvoices({ status: 'PENDING', dueFrom: '2026-11-01', dueTo: '2026-11-30', limit: 5 });
    expect(out.data).toHaveLength(1);
    expect(out.meta).toEqual({ nextCursor: null, limit: 5 });
    const sel = queries.find((x) => x.sql.includes('FROM invoices'));
    expect(sel?.sql).toContain('status = $1');
    expect(sel?.sql).toContain('"dueDate" >= $2');
    expect(sel?.sql).toContain('"dueDate" <= $3');
    expect(sel?.params).toEqual(['PENDING', '2026-11-01', '2026-11-30', 6]);
  });

  it('cursor = id opaco: ancora no (createdAt,id) e filtra tupla; nextCursor = último id', async () => {
    const anchor = { createdAt: new Date('2026-10-02T00:00:00Z'), id: 'inv-9' };
    const page = [invoiceRow({ id: 'inv-10' }, 10), invoiceRow({ id: 'inv-11' }, 11)];
    const { pool, queries } = mockPool((sql, params) => {
      if (sql.includes('SELECT "createdAt", id FROM invoices WHERE id = $1')) return { rows: [anchor] };
      if (sql.includes('FROM invoices')) {
        // Só a chamada com cursor carrega âncora (params [createdAt, id, limit+1]);
        // a primeira chamada (só limit) pula as asserções de âncora.
        if (params && params.length > 1) {
          expect(params?.[0]).toBe(anchor.createdAt);
          expect(params?.[1]).toBe('inv-9');
        }
        return { rows: page };
      }
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    const out = await svc.listInvoices({ limit: 1 });
    // 2 linhas p/ limit 1 → hasMore: corta p/ 1 e nextCursor = id do último da página
    void out;
    const out2 = await svc.listInvoices({ limit: 1, cursor: 'inv-9' });
    expect(out2.data).toHaveLength(1);
    expect(out2.meta).toEqual({ nextCursor: 'inv-10', limit: 1 });
    expect(queries.some((x) => x.sql.includes('(("createdAt", id) > ('))).toBe(true);
    expect(queries.some((x) => /\bOFFSET\b/i.test(x.sql))).toBe(false); // nunca offset
  });

  it('teto 100: limit acima é grampeado', async () => {
    const { pool, queries } = mockPool(() => ({ rows: [] }));
    const svc = new BillingService(pool as never);
    const out = await svc.listInvoices({ limit: 5000 });
    expect(out.meta.limit).toBe(100);
    const sel = queries.find((x) => x.sql.includes('FROM invoices'));
    expect(sel?.params?.[sel.params.length - 1]).toBe(101);
  });
});

describe('BillingService.listSubscriptions', () => {
  it('lista vazia → envelope com nextCursor null', async () => {
    const { pool } = mockPool(() => ({ rows: [] }));
    const svc = new BillingService(pool as never);
    await expect(svc.listSubscriptions({})).resolves.toEqual({ data: [], meta: { nextCursor: null, limit: 20 } });
  });

  it('filtro status + cursor opaco (sem offset)', async () => {
    const anchor = { createdAt: new Date('2026-10-02T00:00:00Z'), id: 'sub-9' };
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('SELECT "createdAt", id FROM subscriptions WHERE id = $1')) return { rows: [anchor] };
      if (sql.includes('FROM subscriptions')) return { rows: [subRow(), subRow({}, 1)] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    const out = await svc.listSubscriptions({ status: 'ACTIVE', limit: 1, cursor: 'sub-9' });
    expect(out.data).toHaveLength(1);
    expect(out.meta.nextCursor).toBe('sub-0');
    const sel = queries.find((x) => x.sql.includes('FROM subscriptions') && x.sql.includes('ORDER BY'));
    expect(sel?.sql).toContain('subscriptions.status = $1');
    expect(sel?.sql).toContain('((subscriptions."createdAt", subscriptions.id) > (');
    expect(queries.some((x) => /\bOFFSET\b/i.test(x.sql))).toBe(false);
  });
});

describe('BillingService.listInvoicePayments', () => {
  it('fatura inexistente → 404 sem PII', async () => {
    const { pool } = mockPool(() => ({ rows: [] }));
    const svc = new BillingService(pool as never);
    const err = await svc.listInvoicePayments('inv-ausente').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(String((err as Error).message)).not.toMatch(/cpf|cnpj|email/i);
  });

  it('fatura sem payments → [] honesto', async () => {
    const { pool } = mockPool((sql) => {
      if (sql.includes('FROM invoices WHERE id')) return { rows: [invoiceRow()] };
      if (sql.includes('FROM payments')) return { rows: [] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    await expect(svc.listInvoicePayments('inv-0')).resolves.toEqual([]);
  });

  it('retorna payments da fatura com teto (sem dump)', async () => {
    const pay = { id: 'pay-1', invoiceId: 'inv-0', status: 'PENDING' };
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM invoices WHERE id')) return { rows: [invoiceRow()] };
      if (sql.includes('FROM payments')) return { rows: [pay] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    const out = await svc.listInvoicePayments('inv-0');
    expect(out).toEqual([pay]);
    const sel = queries.find((x) => x.sql.includes('FROM payments'));
    expect(sel?.sql).toContain('LIMIT 100');
  });
});
