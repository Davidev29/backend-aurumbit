// Testes do sync billing→finance (Fase 5, PROJECT.md §5).
// Sem PG/Redis: fake em memória implementando a superfície SQL usada pelo
// `FinanceSyncService` (mesmo padrão de `billing/webhook.spec.ts`).

import { FinanceSyncService, projectionMarkerIdOf, type FinanceEnvelope } from './sync.service';
import { financeSyncJobOptions } from './sync.queue';
import { classifyRefund, normalizeFinanceTopic, shouldApplyFinanceEvent } from './sync.transitions';

type Row = Record<string, unknown>;

function makeFakeDb() {
  const processed = new Map<string, Row>();
  const receivables = new Map<string, Row>();
  const payables = new Map<string, Row>();
  const txns: Row[] = [];
  const snapshots = new Map<string, Row>();
  const outbox: Array<{ eventId: string; type: string; payload: Row }> = [];
  const calls: Array<{ sql: string; params?: unknown[] }> = [];

  const key = (provider: unknown, externalId: unknown) => `${provider}|${externalId}`;

  async function query(sql: string, params?: unknown[]) {
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rowCount: 1, rows: [] as Row[] };
    }
    if (sql.includes('INSERT INTO finance_processed_events')) {
      const eventId = String(params?.[1]);
      if (processed.has(eventId)) return { rowCount: 0, rows: [] as Row[] };
      const row = { id: params?.[0], eventId };
      processed.set(eventId, row);
      return { rowCount: 1, rows: [row] };
    }
    if (sql.includes('FROM receivables WHERE provider')) {
      const row = receivables.get(key(params?.[0], params?.[1]));
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }
    if (sql.startsWith('INSERT INTO receivables')) {
      // Layout A (status literal no SQL): [id, customerId, invoiceId, provider,
      // externalId, amountCents, version, occurredAt, dueDate, paidAt].
      // Layout B (status em $7): [..., status, version, occurredAt, dueDate].
      const literal = sql.includes("'RECEBIDO'")
        ? 'RECEBIDO'
        : sql.includes("'INADIMPLENTE'")
          ? 'INADIMPLENTE'
          : null;
      const p = params as unknown[];
      const row: Row = literal
        ? {
            id: p[0], customerId: p[1], invoiceId: p[2], provider: p[3], externalId: p[4],
            amountCents: p[5], status: literal, version: p[6], occurredAt: p[7],
            dueDate: p[8], paidAt: p[9],
          }
        : {
            id: p[0], customerId: p[1], invoiceId: p[2], provider: p[3], externalId: p[4],
            amountCents: p[5], status: p[6], version: p[7], occurredAt: p[8],
            dueDate: p[9], paidAt: null,
          };
      receivables.set(key(row.provider, row.externalId), row);
      return { rowCount: 1, rows: [row] };
    }
    if (sql.startsWith('UPDATE receivables')) {
      const p = params as unknown[];
      const row = [...receivables.values()].find((r) => r.id === p[0]);
      if (!row) return { rowCount: 0, rows: [] as Row[] };
      if (sql.includes("status = 'RECEBIDO'")) {
        row.status = 'RECEBIDO';
        row.amountCents = p[1];
        row.version = p[2];
        if (p[3] != null) row.occurredAt = p[3];
        if (p[4] != null) row.paidAt = p[4];
      } else if (sql.includes("status = 'INADIMPLENTE'")) {
        row.status = 'INADIMPLENTE';
        row.version = p[1];
        if (p[2] != null) row.occurredAt = p[2];
        if (p[3] != null) row.dueDate = p[3];
      } else {
        row.status = p[1];
        row.version = p[2];
        if (p[3] != null) row.occurredAt = p[3];
        if (p[4] != null) row.dueDate = p[4];
      }
      return { rowCount: 1, rows: [row] };
    }
    if (sql.includes('FROM payables WHERE provider')) {
      const row = payables.get(key(params?.[0], params?.[1]));
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }
    if (sql.startsWith('INSERT INTO payables')) {
      const p = params as unknown[];
      const row: Row = {
        id: p[0], refundId: p[1], paymentExternalId: p[2], provider: p[3],
        externalId: p[4], amountCents: p[5], status: 'PAGO', version: p[6],
        occurredAt: p[7], paidAt: p[8],
      };
      payables.set(key(row.provider, row.externalId), row);
      return { rowCount: 1, rows: [row] };
    }
    if (sql.startsWith('UPDATE payables')) {
      const p = params as unknown[];
      const row = [...payables.values()].find((r) => r.id === p[0]);
      if (!row) return { rowCount: 0, rows: [] as Row[] };
      row.status = 'PAGO';
      row.amountCents = p[1];
      row.version = p[2];
      if (p[3] != null) {
        row.occurredAt = p[3];
        row.paidAt = p[3];
      }
      return { rowCount: 1, rows: [row] };
    }
    if (sql.startsWith('INSERT INTO finance_transactions')) {
      const p = params as unknown[];
      const dup =
        txns.some((t) => t.eventId === p[4]) ||
        txns.some((t) => t.provider === p[2] && t.externalId === p[3]);
      if (dup) return { rowCount: 0, rows: [] as Row[] }; // ON CONFLICT DO NOTHING
      const row: Row = {
        id: p[0],
        kind: sql.includes("'INCOME'") ? 'INCOME' : 'EXPENSE',
        amountCents: p[1], provider: p[2], externalId: p[3], eventId: p[4],
        receivableId: p[5], occurredAt: p[6],
      };
      txns.push(row);
      return { rowCount: 1, rows: [row] };
    }
    if (sql.includes('FROM finance_transactions WHERE')) {
      const found = txns.filter(
        (t) => t.eventId === params?.[0] || (t.provider === params?.[1] && t.externalId === params?.[2]),
      );
      return { rowCount: found.length, rows: found };
    }
    if (sql.includes('FROM projection_snapshots WHERE scope')) {
      const row = snapshots.get(String(params?.[0]));
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }
    if (sql.startsWith('INSERT INTO projection_snapshots')) {
      const scope = String(params?.[1]);
      const row = snapshots.get(scope) ?? { id: params?.[0], scope };
      row.valid = false;
      row.invalidatedAt = new Date().toISOString();
      snapshots.set(scope, row);
      return { rowCount: 1, rows: [row] };
    }
    if (sql.startsWith('UPDATE projection_snapshots')) {
      const row = [...snapshots.values()].find((r) => r.id === params?.[0]);
      if (!row) return { rowCount: 0, rows: [] as Row[] };
      row.valid = false;
      row.invalidatedAt = new Date().toISOString();
      return { rowCount: 1, rows: [row] };
    }
    if (sql.includes('INSERT INTO outbox_events')) {
      const eventId = String(params?.[1]);
      if (outbox.some((o) => o.eventId === eventId)) {
        return { rowCount: 0, rows: [] as Row[] };
      }
      outbox.push({
        eventId,
        type: String(params?.[4]),
        payload: JSON.parse(String(params?.[5])) as Row,
      });
      return { rowCount: 1, rows: [{ id: params?.[0], eventId }] };
    }
    throw new Error(`SQL não mapeado no fake: ${sql.slice(0, 80)}`);
  }

  const client = { query, release: jest.fn() };
  const pool = { query, connect: jest.fn(async () => client) };
  return { pool, client, processed, receivables, payables, txns, snapshots, outbox, calls };
}

const PAYLOAD_CONFIRMED = {
  provider: 'ASAAS',
  externalId: 'pay-ext-1',
  invoiceId: 'inv-1',
  customerId: 'cust-1',
  amountCents: 1000,
  paidAt: '2026-10-10T12:00:00.000Z',
  occurredAt: '2026-10-10T12:00:00.000Z',
};

function envelope(over: Partial<FinanceEnvelope> & { type?: string; topic?: string }): FinanceEnvelope {
  return { eventId: 'evt-1', type: 'PaymentConfirmed', payload: {}, ...over };
}

describe('FinanceSyncService — PaymentConfirmed', () => {
  it('aplica RECEBIDO + INCOME + outbox na mesma transação', async () => {
    const fake = makeFakeDb();
    const svc = new FinanceSyncService(fake.pool as never);
    const out = await svc.handleEnvelope(
      envelope({ eventId: 'evt-conf-1', payload: { ...PAYLOAD_CONFIRMED } }),
    );
    expect(out.status).toBe('applied');
    const rec = fake.receivables.get('ASAAS|pay-ext-1');
    expect(rec?.status).toBe('RECEBIDO');
    expect(fake.txns).toHaveLength(1);
    expect(fake.txns[0].kind).toBe('INCOME');
    expect(fake.txns[0].amountCents).toBe(1000);
    expect(fake.outbox.map((o) => o.type)).toEqual(['FinanceTransactionPosted']);
  });

  it('replay do mesmo eventId não duplica Transaction nem saldo', async () => {
    const fake = makeFakeDb();
    const svc = new FinanceSyncService(fake.pool as never);
    const first = envelope({ eventId: 'evt-conf-2', payload: { ...PAYLOAD_CONFIRMED, externalId: 'pay-ext-2' } });
    expect((await svc.handleEnvelope(first)).status).toBe('applied');
    const replay = await svc.handleEnvelope(first);
    expect(replay).toEqual({ status: 'duplicate', eventId: 'evt-conf-2' });
    expect(fake.txns).toHaveLength(1);
    expect(fake.outbox).toHaveLength(1);
    const saldo = fake.txns.reduce((s, t) => s + Number(t.amountCents), 0);
    expect(saldo).toBe(1000);
  });

  it('segunda via do mesmo pagamento (eventId novo, ex. recon) não duplica lançamento', async () => {
    const fake = makeFakeDb();
    const svc = new FinanceSyncService(fake.pool as never);
    await svc.handleEnvelope(envelope({ eventId: 'evt-conf-3', payload: { ...PAYLOAD_CONFIRMED, externalId: 'pay-ext-3' } }));
    const second = await svc.handleEnvelope(
      envelope({ eventId: 'recon:pay-ext-3:2026-10-10', payload: { ...PAYLOAD_CONFIRMED, externalId: 'pay-ext-3' } }),
    );
    expect(second.status).toBe('noop'); // receivable atualizado, txn em conflito → sem outbox nova
    expect(fake.txns).toHaveLength(1);
    expect(fake.outbox).toHaveLength(1);
  });
});

describe('FinanceSyncService — fora de ordem nunca regride', () => {
  it('PaymentFailed antigo após RECEBIDO mantém RECEBIDO sem ReceivableOverdue', async () => {
    const fake = makeFakeDb();
    const svc = new FinanceSyncService(fake.pool as never);
    await svc.handleEnvelope(envelope({ eventId: 'evt-c4', payload: { ...PAYLOAD_CONFIRMED, externalId: 'pay-ext-4' } }));
    const failed = await svc.handleEnvelope(
      envelope({
        eventId: 'evt-f4',
        type: 'PaymentFailed',
        occurredAt: '2026-10-09T00:00:00.000Z', // mais antigo que o paidAt
        payload: { provider: 'ASAAS', externalId: 'pay-ext-4', amountCents: 1000, dueDate: '2026-10-01T00:00:00.000Z' },
      }),
    );
    expect(failed.status).toBe('noop');
    expect(fake.receivables.get('ASAAS|pay-ext-4')?.status).toBe('RECEBIDO');
    expect(fake.outbox.map((o) => o.type)).toEqual(['FinanceTransactionPosted']);
  });

  it('InvoiceOverdue após RECEBIDO não regride', async () => {
    const fake = makeFakeDb();
    const svc = new FinanceSyncService(fake.pool as never);
    await svc.handleEnvelope(envelope({ eventId: 'evt-c5', payload: { ...PAYLOAD_CONFIRMED, externalId: 'pay-ext-5' } }));
    const overdue = await svc.handleEnvelope(
      envelope({
        eventId: 'evt-o5',
        type: 'InvoiceOverdue',
        payload: { invoiceId: 'inv-1', asaasInvoiceId: 'pay-ext-5', amountCents: 1000, dueDate: '2026-10-01T00:00:00.000Z' },
      }),
    );
    expect(overdue.status).toBe('noop');
    expect(fake.receivables.get('ASAAS|pay-ext-5')?.status).toBe('RECEBIDO');
  });

  it('PaymentFailed vencido cria INADIMPLENTE + ReceivableOverdue', async () => {
    const fake = makeFakeDb();
    const svc = new FinanceSyncService(fake.pool as never);
    const out = await svc.handleEnvelope(
      envelope({
        eventId: 'evt-f6',
        type: 'PaymentFailed',
        payload: { provider: 'ASAAS', externalId: 'pay-ext-6', amountCents: 500, dueDate: '2026-10-01T00:00:00.000Z' },
      }),
    );
    expect(out.status).toBe('applied');
    expect(fake.receivables.get('ASAAS|pay-ext-6')?.status).toBe('INADIMPLENTE');
    expect(fake.outbox.map((o) => o.type)).toEqual(['ReceivableOverdue']);
  });
});

describe('FinanceSyncService — RefundCompleted parcial vs total', () => {
  it('parcial (400/1000): Payable PAGO + EXPENSE 400 + PARTIALLY_REFUNDED', async () => {
    const fake = makeFakeDb();
    const svc = new FinanceSyncService(fake.pool as never);
    const out = await svc.handleEnvelope(
      envelope({
        eventId: 'evt-r1',
        type: 'RefundCompleted',
        payload: {
          refundId: 'ref-1', paymentExternalId: 'pay-ext-1', externalId: 'ref-ext-1',
          amountCents: 400, paymentAmountCents: 1000, refundedTotalCents: 400,
        },
      }),
    );
    expect(out.status).toBe('applied');
    expect(fake.payables.get('ASAAS|ref-ext-1')?.status).toBe('PAGO');
    expect(fake.txns).toHaveLength(1);
    expect(fake.txns[0]).toMatchObject({ kind: 'EXPENSE', amountCents: 400 });
    const posted = fake.outbox.find((o) => o.type === 'FinanceTransactionPosted');
    expect(posted?.payload.refundClassification).toBe('PARTIALLY_REFUNDED');
    expect(posted?.payload.billingTodo).toBe('Payment→PARTIALLY_REFUNDED');
  });

  it('total (1000/1000): REFUNDED', async () => {
    const fake = makeFakeDb();
    const svc = new FinanceSyncService(fake.pool as never);
    await svc.handleEnvelope(
      envelope({
        eventId: 'evt-r2',
        type: 'billing.refund.completed.v1', // alias de tópico também roteia
        payload: {
          refundId: 'ref-2', externalId: 'ref-ext-2',
          amountCents: 1000, paymentAmountCents: 1000, refundedTotalCents: 1000,
        },
      }),
    );
    const posted = fake.outbox.find((o) => o.type === 'FinanceTransactionPosted');
    expect(posted?.payload.refundClassification).toBe('REFUNDED');
  });

  it('replay do mesmo RefundCompleted não duplica EXPENSE', async () => {
    const fake = makeFakeDb();
    const svc = new FinanceSyncService(fake.pool as never);
    const env = envelope({
      eventId: 'evt-r3',
      type: 'RefundCompleted',
      payload: { refundId: 'ref-3', externalId: 'ref-ext-3', amountCents: 200, paymentAmountCents: 1000 },
    });
    expect((await svc.handleEnvelope(env)).status).toBe('applied');
    expect(await svc.handleEnvelope(env)).toEqual({ status: 'duplicate', eventId: 'evt-r3' });
    expect(fake.txns).toHaveLength(1);
    expect(fake.outbox).toHaveLength(1);
  });
});

describe('FinanceSyncService — projeção e tipos desconhecidos', () => {
  it('SubscriptionCancelled invalida snapshot + ProjectionRecomputed; repetição vira noop', async () => {
    const fake = makeFakeDb();
    const svc = new FinanceSyncService(fake.pool as never);
    const out = await svc.handleEnvelope(
      envelope({ eventId: 'evt-s1', type: 'SubscriptionCancelled', payload: { subscriptionId: 'sub-1' } }),
    );
    expect(out.status).toBe('applied');
    expect(fake.snapshots.get('global')?.valid).toBe(false);
    expect(fake.outbox.map((o) => o.type)).toEqual(['ProjectionRecomputed']);
    const again = await svc.handleEnvelope(
      envelope({ eventId: 'evt-s2', type: 'SubscriptionCancelled', payload: { subscriptionId: 'sub-1' } }),
    );
    expect(again.status).toBe('noop');
    expect(fake.outbox).toHaveLength(1);
  });

  // O UNIQUE global de `scope` saiu em 20261017000000 (o core precisa de 1
  // snapshot por PERÍODO), então o marcador arbitra pela PK `id`.
  it('marcador usa id determinístico por namespace e ON CONFLICT (id) — não (scope)', async () => {
    const fake = makeFakeDb();
    const svc = new FinanceSyncService(fake.pool as never);
    await svc.handleEnvelope(envelope({ eventId: 'evt-m1', type: 'SubscriptionActivated', payload: {} }));
    await svc.handleEnvelope(
      envelope({ eventId: 'evt-m2', type: 'SubscriptionActivated', payload: { orgId: 'org-1' } }),
    );

    const inserts = fake.calls.filter((c) => c.sql.startsWith('INSERT INTO projection_snapshots'));
    expect(inserts).toHaveLength(2);
    for (const call of inserts) {
      expect(call.sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(call.sql).not.toContain('ON CONFLICT (scope)');
      expect(call.params?.[0]).toBe(projectionMarkerIdOf(String(call.params?.[1]))); // id estável
    }
    expect(fake.snapshots.size).toBe(2); // 'global' e 'org:org-1' são namespaces distintos
    expect(fake.snapshots.get('global')?.id).toBe(projectionMarkerIdOf('global'));
    expect(fake.snapshots.get('org:org-1')?.id).toBe(projectionMarkerIdOf('org:org-1'));
  });

  it('tipo desconhecido → noop sem DLQ', async () => {
    const fake = makeFakeDb();
    const svc = new FinanceSyncService(fake.pool as never);
    const out = await svc.handleEnvelope(envelope({ eventId: 'evt-x', type: 'AlgoNovo.v1' }));
    expect(out).toEqual({ status: 'noop', eventId: 'evt-x', reason: 'tipo-desconhecido' });
    expect(fake.processed.size).toBe(0);
  });
});

describe('finance — transições puras e fila', () => {
  it('normalizeFinanceTopic cobre aliases do relay billing', () => {
    expect(normalizeFinanceTopic('PaymentConfirmed')).toBe('PaymentConfirmed');
    expect(normalizeFinanceTopic('billing.payment.confirmed.v1')).toBe('PaymentConfirmed');
    expect(normalizeFinanceTopic('SubscriptionCancelled')).toBe('SubscriptionCancelled');
    expect(normalizeFinanceTopic('billing.subscription.cancelled.v1')).toBe('SubscriptionCancelled');
    expect(normalizeFinanceTopic('DepositConfirmed')).toBeNull();
  });

  it('classifyRefund parcial vs total', () => {
    expect(classifyRefund({ refundAmountCents: 400, paymentAmountCents: 1000 })).toBe('PARTIALLY_REFUNDED');
    expect(classifyRefund({ refundAmountCents: 1000, paymentAmountCents: 1000 })).toBe('REFUNDED');
    expect(classifyRefund({ refundAmountCents: 700 })).toBe('REFUNDED');
  });

  it('shouldApplyFinanceEvent nunca regride terminal', () => {
    expect(shouldApplyFinanceEvent({ currentStatus: 'RECEBIDO' }).apply).toBe(false);
    expect(shouldApplyFinanceEvent({ currentStatus: 'PAGO' }).apply).toBe(false);
    expect(
      shouldApplyFinanceEvent({ currentStatus: 'PENDENTE', currentVersion: 5, incomingVersion: 3 }).apply,
    ).toBe(false);
    expect(
      shouldApplyFinanceEvent({ currentStatus: 'PENDENTE', currentVersion: 2, incomingVersion: 3 }).apply,
    ).toBe(true);
  });

  it('financeSyncJobOptions usa jobId=eventId (PROJECT.md §5)', () => {
    const opts = financeSyncJobOptions('evt-abc');
    expect(opts.jobId).toBe('evt-abc');
    expect(opts.attempts).toBe(5);
  });
});
