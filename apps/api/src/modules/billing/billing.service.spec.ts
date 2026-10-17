import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { BillingService } from './billing.service';

// Fase 4 — BillingService com Pool PG mockado (sem banco).
// Convenção do mock: `query` responde por prefixo/conteúdo do SQL
// (mesmo padrão de devices.service.spec.ts).

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
    (x) => x.sql.includes('outbox_events') && JSON.stringify(x.params ?? []).includes(type),
  );
}

function paymentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    provider: 'ASAAS',
    externalId: 'ext-1',
    customerId: 'cust-1',
    invoiceId: null,
    amountCents: 1000,
    method: 'PIX',
    status: 'PENDING',
    idempotencyKey: 'key-1',
    paidAt: null,
    version: 1,
    occurredAt: null,
    ...over,
  };
}

function invoiceRow(over: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    number: 'INV-2026-000001',
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
    idempotencyKey: 'inv-key-1',
    ...over,
  };
}

describe('BillingService — idempotência (replay não duplica)', () => {
  it('registerPayment: replay do mesmo externalId retorna o existente sem duplicar', async () => {
    const existing = paymentRow();
    const { pool, queries } = mockPool((sql) => {
      if (sql.startsWith('INSERT INTO payments')) return { rows: [] }; // ON CONFLICT DO NOTHING
      if (sql.includes('WHERE provider = $1')) return { rows: [existing] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    const out = await svc.registerPayment(
      { provider: 'ASAAS', externalId: 'ext-1', customerId: 'cust-1', amountCents: 1000 },
      'key-replay',
    );
    expect(out.id).toBe('pay-1');
    expect(queries.filter((q) => q.sql.startsWith('INSERT INTO payments'))).toHaveLength(1);
    expect(emittedOutbox(queries, 'billing.payment.confirmed.v1')).toBe(false);
  });

  it('createSubscription: replay da mesma Idempotency-Key retorna sem INSERT', async () => {
    const existing = { id: 'sub-1', status: 'DRAFT', idempotencyKey: 'sub-key' };
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM subscriptions WHERE "idempotencyKey"')) return { rows: [existing] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    const out = await svc.createSubscription({ customerId: 'cust-1' }, 'sub-key');
    expect(out.id).toBe('sub-1');
    expect(queries.some((q) => q.sql.startsWith('INSERT INTO subscriptions'))).toBe(false);
  });

  it('confirmPayment replay (já CONFIRMED) retorna sem UPDATE nem outbox', async () => {
    const confirmed = paymentRow({ status: 'CONFIRMED', paidAt: new Date('2026-10-10T00:00:00Z') });
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM payments WHERE id')) return { rows: [confirmed] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    const out = await svc.confirmPayment('pay-1', { amountCents: 1000, paidAt: '2026-10-10T00:00:00.000Z' });
    expect(out.status).toBe('CONFIRMED');
    expect(queries.some((q) => q.sql.startsWith('UPDATE payments'))).toBe(false);
    expect(emittedOutbox(queries, 'billing.payment.confirmed.v1')).toBe(false);
  });
});

describe('BillingService — transição ilegal → 422 + alerta, sem sobrescrever', () => {  it('cancelInvoice em PAID → 422 e nenhum UPDATE', async () => {
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM invoices WHERE id')) return { rows: [invoiceRow({ status: 'PAID' })] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    await expect(svc.cancelInvoice('inv-1', { reason: 'motivo valido aqui' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(queries.some((q) => q.sql.startsWith('UPDATE invoices'))).toBe(false);
    expect(emittedOutbox(queries, 'InvoiceCancelled')).toBe(false);
  });

  it('confirmPayment com valor divergente → 422 sem UPDATE', async () => {
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM payments WHERE id')) return { rows: [paymentRow()] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    await expect(
      svc.confirmPayment('pay-1', { amountCents: 9999, paidAt: '2026-10-10T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(queries.some((q) => q.sql.startsWith('UPDATE payments'))).toBe(false);
  });

  it('createRefund em pagamento não-CONFIRMED → 422', async () => {
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM payments WHERE id')) return { rows: [paymentRow({ status: 'PENDING' })] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    await expect(svc.createRefund('pay-1', { amountCents: 1000 })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(queries.some((q) => q.sql.startsWith('INSERT INTO refunds'))).toBe(false);
  });
});

describe('BillingService — hook PaymentConfirmed emite outbox', () => {
  it('CONFIRMED + fatura PENDING→PAID na mesma transação + outbox', async () => {
    const pending = paymentRow({ invoiceId: 'inv-1' });
    const confirmed = paymentRow({ invoiceId: 'inv-1', status: 'CONFIRMED' });
    const { pool, queries } = mockPool((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM payments WHERE id')) return { rows: [pending] };
      if (sql.startsWith('UPDATE payments SET status')) return { rows: [confirmed] };
      if (sql.includes('FROM invoices WHERE id = $1')) return { rows: [invoiceRow({ status: 'PENDING' })] };
      if (sql.includes("SET status = 'PAID'")) return { rows: [invoiceRow({ status: 'PAID' })] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    const out = await svc.confirmPayment('pay-1', {
      amountCents: 1000,
      paidAt: '2026-10-10T00:00:00.000Z',
    });
    expect(out.payment.status).toBe('CONFIRMED');
    expect(out.invoice.status).toBe('PAID');
    expect(emittedOutbox(queries, 'billing.payment.confirmed.v1')).toBe(true);
  });

  it('evento fora de ordem (version antiga) não sobrescreve', async () => {
    const current = paymentRow({ status: 'AWAITING', version: 5 });
    const { pool, queries } = mockPool((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM payments WHERE id')) return { rows: [current] };
      if (sql.startsWith('UPDATE payments SET status')) return { rows: [paymentRow({ status: 'CONFIRMED' })] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    const out = await svc.confirmPayment('pay-1', {
      amountCents: 1000,
      paidAt: '2026-10-10T00:00:00.000Z',
      version: 3,
    });
    expect(out.status).toBe('AWAITING');
    expect(queries.some((q) => q.sql.startsWith('UPDATE payments'))).toBe(false);
  });
});

/**
 * D1-4/D1-5 — webhook duplicado do provedor: duas confirmações
 * concorrentes do MESMO pagamento. `getPayment()` + `check()` rodam FORA
 * da txn, então sem guarda de status no WHERE as duas emitem
 * `PaymentConfirmed` no outbox. Harness no padrão de
 * `finance-automation.spec.ts:274-320`: fake PG stateful que só faz o
 * UPDATE casar se o pagamento ainda NÃO estiver CONFIRMED — e só quando a
 * guarda está LITERALMENTE no SQL (sem ela o teste acusa a duplicidade).
 */
describe('BillingService — concorrência: 1 PaymentConfirmed por pagamento', () => {
  function confirmRaceHarness() {
    const state = { row: paymentRow() as Record<string, unknown>, outboxEventIds: [] as string[] };
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const q = async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (sql.startsWith('UPDATE payments SET status')) {
        const guarded = sql.includes(`status <> 'CONFIRMED'`);
        if (guarded && state.row.status === 'CONFIRMED') return { rows: [], rowCount: 0 }; // perdedor
        state.row = { ...state.row, status: 'CONFIRMED', paidAt: new Date('2026-10-10T00:00:00Z'), version: 2 };
        return { rows: [state.row], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outbox_events')) {
        const eventId = (params ?? [])[1] as string;
        if (state.outboxEventIds.includes(eventId)) return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
        state.outboxEventIds.push(eventId);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM payments WHERE id')) return { rows: [state.row] };
      return { rows: [], rowCount: 0 };
    };
    const client = { query: q, release: jest.fn() };
    const pool = { query: q, connect: jest.fn(async () => client) };
    return { svc: new BillingService(pool as never), state, queries };
  }

  it('confirmPayment duplicado concorrente → 1 UPDATE CONFIRMED, 1 PaymentConfirmed no outbox', async () => {
    const { svc, state, queries } = confirmRaceHarness();
    const [a, b] = await Promise.all([
      svc.confirmPayment('pay-1', { amountCents: 1000, paidAt: '2026-10-10T00:00:00.000Z' }),
      svc.confirmPayment('pay-1', { amountCents: 1000, paidAt: '2026-10-10T00:00:00.000Z' }),
    ]);
    expect(queries.filter((q) => q.sql.startsWith('UPDATE payments SET status'))).toHaveLength(2);
    // só UM casou a guarda (o outro devolveu 0 linhas → ROLLBACK)
    expect(queries.filter((q) => q.sql.includes('ROLLBACK'))).toHaveLength(1);
    expect(queries.filter((q) => q.sql.includes('INSERT INTO outbox_events'))).toHaveLength(1);
    expect(state.outboxEventIds).toEqual(['billing:payment-confirmed:pay-1']);
    // o perdedor devolve o estado atual (replay), não 500
    expect(b.status).toBe('CONFIRMED');
    expect('payment' in b ? b.payment.status : b.status).toBe('CONFIRMED');
    void a;
    expect(queries.find((q) => q.sql.startsWith('UPDATE payments SET status'))?.sql).toContain(
      `AND status <> 'CONFIRMED'`,
    );
  });

  it('eventId de PaymentConfirmed é determinístico e protege o UNIQUE(eventId)', async () => {
    const { svc, queries } = confirmRaceHarness();
    await svc.confirmPayment('pay-1', { amountCents: 1000, paidAt: '2026-10-10T00:00:00.000Z' });
    const outbox = queries.find((q) => q.sql.includes('INSERT INTO outbox_events'));
    expect(outbox?.params?.[1]).toBe('billing:payment-confirmed:pay-1');
    expect(outbox?.sql).toContain('ON CONFLICT ("eventId") DO NOTHING');
    // prefixo não colide com a rota de reconciliação (`recon:`)
    expect(String(outbox?.params?.[1]).startsWith('recon:')).toBe(false);
    // e tem os 3 segmentos exigidos pelo `jobId = eventId` do relay BullMQ
    // (2 lance `Custom Id cannot contain :` e travam o tick — ver
    // billing-transitions.spec.ts).
    expect(String(outbox?.params?.[1]).split(':')).toHaveLength(3);
  });
});

describe('BillingService — Fase 8 comercial (billingInterval + checkout)', () => {
  const noDb = () => {
    const { pool, queries } = mockPool(() => {
      throw new Error('nenhuma query deveria executar (validação primeiro)');
    });
    return { svc: new BillingService(pool as never), queries };
  };
  const order = (over: Record<string, unknown> = {}) => ({
    orderId: 'ord-1',
    customerId: 'cust-1',
    productId: 'prod-base',
    planRef: 'AURUM_BASE_YEAR',
    billingInterval: 'YEAR',
    amountCents: 119900,
    ...over,
  });
  it.each([['MONTH'], ['YEAR'], ['ONE_TIME']])('checkout %s: invoice carrega billingInterval', async (interval) => {
    const inv = invoiceRow({ id: 'inv-9', status: 'DRAFT', orderId: 'ord-1' });
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM invoices WHERE "orderId"')) return { rows: [] };
      if (sql.startsWith('INSERT INTO invoices')) return { rows: [{ ...inv, billingInterval: interval }] };
      if (sql.includes('FROM invoices WHERE id')) return { rows: [{ ...inv, billingInterval: interval }] };
      if (sql.includes('UPDATE invoices SET status')) return { rows: [{ ...inv, status: 'PENDING', billingInterval: interval }] };
      if (sql.includes('FROM payments WHERE "invoiceId"')) return { rows: [] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    const out = await svc.createCheckoutOrder(order({ billingInterval: interval }));
    expect(out.status).toBe('PENDING');
    expect(out.billingInterval).toBe(interval);
    const ins = queries.find((q) => q.sql.startsWith('INSERT INTO invoices'));
    expect(ins?.params).toContain(interval);
  });
  it('checkout com intervalo inválido → 400 sem tocar no banco', async () => {
    const { svc, queries } = noDb();
    await expect(svc.createCheckoutOrder(order({ billingInterval: 'WEEK' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(queries).toHaveLength(0);
  });
  it('checkout replay (mesmo orderId) retorna a sessão sem novo INSERT', async () => {
    const inv = invoiceRow({ id: 'inv-9', status: 'PENDING', orderId: 'ord-1', billingInterval: 'ONE_TIME' });
    const { pool, queries } = mockPool((sql) => {
      if (sql.includes('FROM invoices WHERE "orderId"')) return { rows: [inv] };
      if (sql.includes('FROM payments WHERE "invoiceId"')) return { rows: [] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    const out = await svc.createCheckoutOrder(order({ billingInterval: 'ONE_TIME' }));
    expect(out.status).toBe('PENDING');
    expect(queries.some((q) => q.sql.startsWith('INSERT INTO invoices'))).toBe(false);
  });
  it('createSubscription com intervalo inválido → 400 sem query', async () => {
    const { svc, queries } = noDb();
    await expect(
      svc.createSubscription({ customerId: 'cust-1', billingInterval: 'SEMANAL' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queries).toHaveLength(0);
  });
  it('getCheckoutOrder PAID quando há payment CONFIRMED', async () => {
    const inv = invoiceRow({ id: 'inv-9', status: 'PENDING', orderId: 'ord-1', billingInterval: 'MONTH' });
    const { pool } = mockPool((sql) => {
      if (sql.includes('FROM invoices WHERE "orderId"')) return { rows: [inv] };
      if (sql.includes('FROM payments WHERE "invoiceId"'))
        return { rows: [paymentRow({ status: 'CONFIRMED', paidAt: new Date('2026-10-14T00:00:00Z') })] };
      return { rows: [] };
    });
    const svc = new BillingService(pool as never);
    const out = await svc.getCheckoutOrder('ord-1');
    expect(out.status).toBe('PAID');
    expect(out.payments).toHaveLength(1);
  });
});
