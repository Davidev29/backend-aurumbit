import { UnprocessableEntityException } from '@nestjs/common';
import { FinanceService } from './finance.service';

// Fase 5 — FinanceService com Pool PG mockado (sem banco).
// Convenção do mock: `query` responde por prefixo/conteúdo do SQL
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

function emittedOutbox(queries: Array<{ sql: string; params?: unknown[] }>, type: string): boolean {
  return queries.some(
    (x) => x.sql.includes('finance_outbox') && JSON.stringify(x.params ?? []).includes(type),
  );
}

function receivableRow(over: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    orgId: 'org-1',
    sourceType: 'MANUAL',
    sourceId: 'manual:x',
    categoryId: 'cat-1',
    amountCents: 5000,
    dueDate: new Date('2026-11-10T00:00:00Z'),
    status: 'PENDENTE',
    receivedAt: null,
    accountId: null,
    ...over,
  };
}

function payableRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    orgId: 'org-1',
    sourceType: 'MANUAL',
    sourceId: 'manual:y',
    categoryId: 'cat-2',
    amountCents: 2000,
    dueDate: new Date('2026-11-10T00:00:00Z'),
    status: 'PENDENTE',
    paidAt: null,
    accountId: null,
    ...over,
  };
}

function txnRow(over: Record<string, unknown> = {}) {
  return {
    id: 'txn-1',
    orgId: 'org-1',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    kind: 'INCOME',
    amountCents: 5000,
    occurredAt: new Date('2026-10-10T00:00:00Z'),
    receivableId: 'rec-1',
    payableId: null,
    provider: 'MANUAL',
    externalId: 'manual:e1',
    idempotencyKey: 'key-1',
    ...over,
  };
}

const ACTIVE_ACCOUNT = {
  id: 'acc-1',
  orgId: 'org-1',
  code: 'CAIXA',
  name: 'Caixa',
  type: 'CASH',
  balanceCents: 10000,
  active: true,
};

const INCOME_CATEGORY = {
  id: 'cat-1',
  orgId: 'org-1',
  code: 'MENSALIDADE',
  name: 'Mensalidade',
  type: 'INCOME',
  active: true,
};

const EXPENSE_CATEGORY = { ...INCOME_CATEGORY, id: 'cat-2', code: 'FORNECEDOR', type: 'EXPENSE' };

describe('FinanceService — baixa idempotente', () => {
  it('markReceived replay (já RECEBIDO) retorna sem UPDATE/INSERT/outbox', async () => {
    const done = receivableRow({ status: 'RECEBIDO', accountId: 'acc-1' });
    const existing = txnRow();
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM receivables WHERE id')) return { rows: [done] };
      if (sql.includes('FROM financial_transactions WHERE "idempotencyKey"')) return { rows: [] };
      if (sql.includes('FROM financial_transactions WHERE "receivableId"')) return { rows: [existing] };
      return { rows: [] };
    });
    const svc = new FinanceService(pool as never);
    const out = await svc.markReceived('org-1', 'rec-1', { accountId: 'acc-1' }, 'key-1');
    expect(out.receivable.status).toBe('RECEBIDO');
    expect(out.transaction.id).toBe('txn-1');
    expect(queries.some((q) => q.sql.startsWith('UPDATE receivables'))).toBe(false);
    expect(queries.some((q) => q.sql.startsWith('INSERT INTO financial_transactions'))).toBe(false);
    expect(emittedOutbox(queries, 'finance.receivable.received.v1')).toBe(false);
  });

  it('markReceived replay pelo mesmo idempotencyKey retorna sem duplicar', async () => {
    const existing = txnRow({ idempotencyKey: 'key-replay' });
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM financial_transactions WHERE "idempotencyKey"')) return { rows: [existing] };
      if (sql.includes('FROM receivables WHERE id')) return { rows: [receivableRow()] };
      return { rows: [] };
    });
    const svc = new FinanceService(pool as never);
    const out = await svc.markReceived('org-1', 'rec-1', { accountId: 'acc-1' }, 'key-replay');
    expect(out.transaction.id).toBe('txn-1');
    expect(queries.some((q) => q.sql.startsWith('INSERT INTO financial_transactions'))).toBe(false);
    expect(emittedOutbox(queries, 'finance.receivable.received.v1')).toBe(false);
  });

  it('markReceived feliz: RECEBIDO + Transaction INCOME + saldo += valor + outbox na mesma txn', async () => {
    const pending = receivableRow();
    const done = receivableRow({ status: 'RECEBIDO', accountId: 'acc-1' });
    const created = txnRow();
    const { pool, queries } = mockPool((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM financial_transactions WHERE "idempotencyKey"')) return { rows: [] };
      if (sql.includes('FROM receivables WHERE id')) return { rows: [pending] };
      if (sql.includes('FROM financial_accounts WHERE id')) return { rows: [ACTIVE_ACCOUNT] };
      if (sql.includes('FROM financial_categories WHERE id')) return { rows: [INCOME_CATEGORY] };
      if (sql.startsWith('UPDATE receivables SET status')) return { rows: [done] };
      if (sql.startsWith('INSERT INTO financial_transactions')) return { rows: [created] };
      if (sql.includes('"balanceCents" = "balanceCents" +')) return { rows: [] };
      return { rows: [] };
    });
    const svc = new FinanceService(pool as never);
    const out = await svc.markReceived('org-1', 'rec-1', { accountId: 'acc-1' }, 'key-1');
    expect(out.receivable.status).toBe('RECEBIDO');
    expect(out.transaction.kind).toBe('INCOME');
    const balanceUpdate = queries.find((q) => q.sql.includes('"balanceCents" = "balanceCents" +'));
    expect(balanceUpdate?.params?.[2]).toBe(5000);
    expect(emittedOutbox(queries, 'finance.receivable.received.v1')).toBe(true);
  });

  it('markPaid feliz: PAGO + Transaction EXPENSE + saldo -= valor + outbox', async () => {
    const pending = payableRow();
    const done = payableRow({ status: 'PAGO', accountId: 'acc-1' });
    const created = txnRow({ id: 'txn-2', kind: 'EXPENSE', categoryId: 'cat-2', payableId: 'pay-1', receivableId: null });
    const { pool, queries } = mockPool((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM financial_transactions WHERE "idempotencyKey"')) return { rows: [] };
      if (sql.includes('FROM payables WHERE id')) return { rows: [pending] };
      if (sql.includes('FROM financial_accounts WHERE id')) return { rows: [ACTIVE_ACCOUNT] };
      if (sql.includes('FROM financial_categories WHERE id')) return { rows: [EXPENSE_CATEGORY] };
      if (sql.startsWith('UPDATE payables SET status')) return { rows: [done] };
      if (sql.startsWith('INSERT INTO financial_transactions')) return { rows: [created] };
      if (sql.includes('"balanceCents" = "balanceCents" -')) return { rows: [] };
      return { rows: [] };
    });
    const svc = new FinanceService(pool as never);
    const out = await svc.markPaid('org-1', 'pay-1', { accountId: 'acc-1' }, 'key-2');
    expect(out.payable.status).toBe('PAGO');
    expect(out.transaction.kind).toBe('EXPENSE');
    const balanceUpdate = queries.find((q) => q.sql.includes('"balanceCents" = "balanceCents" -'));
    expect(balanceUpdate?.params?.[2]).toBe(2000);
    expect(emittedOutbox(queries, 'finance.payable.paid.v1')).toBe(true);
  });
});

describe('FinanceService — transição ilegal → 422, sem sobrescrever', () => {
  it('markReceived em CANCELADO → 422 sem UPDATE nem outbox', async () => {
    const cancelled = receivableRow({ status: 'CANCELADO' });
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM financial_transactions WHERE "idempotencyKey"')) return { rows: [] };
      if (sql.includes('FROM receivables WHERE id')) return { rows: [cancelled] };
      return { rows: [] };
    });
    const svc = new FinanceService(pool as never);
    await expect(svc.markReceived('org-1', 'rec-1', { accountId: 'acc-1' }, 'k')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(queries.some((q) => q.sql.startsWith('UPDATE receivables'))).toBe(false);
    expect(emittedOutbox(queries, 'finance.receivable.received.v1')).toBe(false);
  });

  it('markPaid em PENDENTE com conta inativa → 422 sem baixa', async () => {
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM financial_transactions WHERE "idempotencyKey"')) return { rows: [] };
      if (sql.includes('FROM payables WHERE id')) return { rows: [payableRow()] };
      if (sql.includes('FROM financial_accounts WHERE id')) return { rows: [{ ...ACTIVE_ACCOUNT, active: false }] };
      return { rows: [] };
    });
    const svc = new FinanceService(pool as never);
    await expect(svc.markPaid('org-1', 'pay-1', { accountId: 'acc-1' }, 'k')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(queries.some((q) => q.sql.startsWith('INSERT INTO financial_transactions'))).toBe(false);
  });

  it('categoria de tipo errado na baixa → 422', async () => {
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM financial_transactions WHERE "idempotencyKey"')) return { rows: [] };
      if (sql.includes('FROM receivables WHERE id')) return { rows: [receivableRow()] };
      if (sql.includes('FROM financial_accounts WHERE id')) return { rows: [ACTIVE_ACCOUNT] };
      if (sql.includes('FROM financial_categories WHERE id')) return { rows: [EXPENSE_CATEGORY] };
      return { rows: [] };
    });
    const svc = new FinanceService(pool as never);
    await expect(svc.markReceived('org-1', 'rec-1', { accountId: 'acc-1' }, 'k')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(queries.some((q) => q.sql.startsWith('UPDATE receivables'))).toBe(false);
  });
});

describe('FinanceService — overview agrega previsto/pendente/realizado + inadimplência', () => {
  it('soma por status, net e delinquencyRate', async () => {
    const recRows = [
      { status: 'PREVISTO', total: '1000', qty: 1 },
      { status: 'PENDENTE', total: '2000', qty: 1 },
      { status: 'RECEBIDO', total: '4000', qty: 1 },
      { status: 'INADIMPLENTE', total: '3000', qty: 1 },
      { status: 'CANCELADO', total: '999', qty: 1 },
    ];
    const payRows = [
      { status: 'PREVISTO', total: '500', qty: 1 },
      { status: 'PAGO', total: '1500', qty: 1 },
    ];
    const { pool } = mockPool((sql) => {
      if (sql.includes('FROM receivables r')) return { rows: recRows };
      if (sql.includes('FROM payables p')) return { rows: payRows };
      if (sql.includes('FROM financial_accounts')) {
        return { rows: [{ id: 'acc-1', code: 'CAIXA', type: 'CASH', balanceCents: 2500 }] };
      }
      return { rows: [] };
    });
    const svc = new FinanceService(pool as never);
    const out = await svc.overview('org-1', '2026-10-01', '2026-10-31');
    expect(out.receivables).toMatchObject({
      previstoCents: 1000,
      pendenteCents: 2000,
      realizadoCents: 4000,
      inadimplenteCents: 3000,
      canceladoCents: 999,
      delinquencyRate: 0.3, // 3000 / (1000+2000+4000+3000)
    });
    expect(out.payables).toMatchObject({ previstoCents: 500, realizadoCents: 1500 });
    expect(out.net).toMatchObject({ previstoCents: 500, realizadoCents: 2500 });
    expect(out.totalBalanceCents).toBe(2500);
  });
});
