import {
  IllegalTransitionError,
  assertPaymentTransition,
  assertTransition,
  buildInvoiceNumber,
  canTransition,
  isOutOfOrderRegression,
  isReconEventId,
  outboxTypeForPaymentStatus,
  paymentConfirmedEventId,
  paymentTargetForAsaasEvent,
  reconEventId,
} from './billing-transitions';
import {
  OUTBOX_RELAY_BATCH,
  OUTBOX_RELAY_DOMAINS,
  buildClaimBatchSql,
  buildMarkPublishedSql,
  buildPurgeSql,
  relayJobId,
  relayOutboxBatch,
} from '../../common/outbox/outbox-relay';

describe('billing-transitions', () => {
  it('fluxo feliz: PENDING → CONFIRMED → REFUNDED', () => {
    expect(assertPaymentTransition('PENDING', 'CONFIRMED')).toEqual({ ok: true });
    expect(assertPaymentTransition('CONFIRMED', 'REFUNDED')).toEqual({ ok: true });
  });

  it.each([
    ['CONFIRMED', 'PENDING'],
    ['PENDING', 'REFUNDED'],
    ['REFUNDED', 'CONFIRMED'],
    ['CANCELLED', 'CONFIRMED'],
  ])('ilegal: %s → %s (REJECTED sem sobrescrever)', (from, to) => {
    const r = assertPaymentTransition(from, to);
    expect(r.ok).toBe(false);
  });

  it('fora de ordem nunca regride terminal', () => {
    expect(isOutOfOrderRegression('CONFIRMED', 'PENDING')).toBe(true);
    expect(isOutOfOrderRegression('REFUNDED', 'CONFIRMED')).toBe(true);
    expect(isOutOfOrderRegression('PENDING', 'CONFIRMED')).toBe(false);
    expect(isOutOfOrderRegression('FAILED', 'PENDING')).toBe(false);
  });

  it('mapeia eventos Asaas; desconhecido → null (REJECT)', () => {
    expect(paymentTargetForAsaasEvent('PAYMENT_CONFIRMED')).toBe('CONFIRMED');
    expect(paymentTargetForAsaasEvent('PAYMENT_RECEIVED')).toBe('CONFIRMED');
    expect(paymentTargetForAsaasEvent('PAYMENT_REFUNDED')).toBe('REFUNDED');
    expect(paymentTargetForAsaasEvent('PAYMENT_OVERDUE')).toBe('FAILED');
    expect(paymentTargetForAsaasEvent('PAYMENT_SUSPENSO_X')).toBeNull();
    expect(outboxTypeForPaymentStatus('CONFIRMED')).toBe('billing.payment.confirmed.v1');
    expect(outboxTypeForPaymentStatus('PENDING')).toBeNull();
  });

  it('eventIds: confirmação determinística; recon sintético `recon:<id>:<data>`', () => {
    expect(paymentConfirmedEventId('pay_abc')).toBe('billing-payment-confirmed:pay_abc');
    expect(reconEventId('p1', '2026-10-10')).toBe('recon:p1:2026-10-10');
    expect(isReconEventId('recon:p1:2026-10-10')).toBe(true);
    expect(isReconEventId('billing-payment-confirmed:pay_abc')).toBe(false);
  });
});

describe('outbox-relay', () => {
  it('claim usa FOR UPDATE SKIP LOCKED em lote de 100, mais antigos primeiro', () => {
    const sql = buildClaimBatchSql();
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain(`LIMIT ${OUTBOX_RELAY_BATCH}`);
    expect(sql).toContain('published = false');
    expect(sql).toContain('ORDER BY "occurredAt" ASC');
  });

  it('cobre billing + domínios existentes', () => {
    expect(OUTBOX_RELAY_DOMAINS).toContain('billing');
    for (const d of ['auth', 'access', 'licensing', 'communications']) {
      expect(OUTBOX_RELAY_DOMAINS).toContain(d);
    }
  });

  it('publica com jobId=eventId e marca published', async () => {
    const rows = [
      { eventId: 'evt-1', aggregate: 'payment', aggregateId: 'p1', type: 'billing.payment.confirmed.v1', payload: {}, occurredAt: '2026-10-10T00:00:00.000Z' },
      { eventId: 'evt-2', aggregate: 'payment', aggregateId: 'p2', type: 'billing.payment.failed.v1', payload: {}, occurredAt: '2026-10-10T00:00:00.000Z' },
    ];
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const added: Array<{ type: string; opts: { jobId: string } }> = [];
    const out = await relayOutboxBatch(
      {
        query: async (sql: string, params?: unknown[]) => {
          queries.push({ sql, params });
          if (sql.startsWith('SELECT')) return { rowCount: 2, rows: rows as unknown as Array<Record<string, unknown>> };
          return { rowCount: 2, rows: [] };
        },
      },
      {
        add: async (type: string, _env: Record<string, unknown>, opts: { jobId: string }) => {
          added.push({ type, opts });
          return {};
        },
      },
    );
    expect(out).toEqual({ claimed: 2, published: 2, eventIds: ['evt-1', 'evt-2'] });
    expect(added.map((a) => a.opts.jobId)).toEqual(['evt-1', 'evt-2']);
    expect(added[0].opts.jobId).toBe(relayJobId('evt-1'));
    const mark = queries.find((q) => q.sql.startsWith('UPDATE'));
    expect(mark?.sql).toBe(buildMarkPublishedSql());
    expect(mark?.params).toEqual([['evt-1', 'evt-2']]);
  });

  it('purge 30d SÓ de publicados (TODO job)', () => {
    const sql = buildPurgeSql();
    expect(sql).toContain('published = true');
    expect(sql).toContain(`interval '30 days'`);
    expect(sql.startsWith('DELETE')).toBe(true);
  });
});

describe('billing-core transitions (núcleo cobrança, REQUIREMENTS.md §3)', () => {
  it.each([
    ['subscription', 'DRAFT', 'ACTIVE'],
    ['subscription', 'ACTIVE', 'PAST_DUE'],
    ['subscription', 'PAST_DUE', 'ACTIVE'],
    ['subscription', 'ACTIVE', 'SUSPENDED'],
    ['subscription', 'SUSPENDED', 'ACTIVE'],
    ['subscription', 'SUSPENDED', 'EXPIRED'],
    ['invoice', 'DRAFT', 'PENDING'],
    ['invoice', 'PENDING', 'PAID'],
    ['invoice', 'PENDING', 'OVERDUE'],
    ['invoice', 'OVERDUE', 'PAID'],
    ['invoice', 'PAID', 'REFUNDED'],
    ['payment', 'PENDING', 'PROCESSING'],
    ['payment', 'PENDING', 'AWAITING'],
    ['payment', 'PENDING', 'CONFIRMED'],
    ['payment', 'PROCESSING', 'CONFIRMED'],
    ['payment', 'AWAITING', 'CONFIRMED'],
    ['payment', 'AWAITING', 'EXPIRED'],
    ['payment', 'CONFIRMED', 'REFUNDED'],
    ['payment', 'CONFIRMED', 'CHARGEBACK'],
    ['payment', 'FAILED', 'PENDING'],
    ['payment', 'EXPIRED', 'PENDING'],
    ['refund', 'REQUESTED', 'PROCESSING'],
    ['refund', 'PROCESSING', 'COMPLETED'],
    ['refund', 'PROCESSING', 'FAILED'],
    ['refund', 'FAILED', 'REQUESTED'],
    ['webhook', 'RECEIVED', 'VALIDATED'],
    ['webhook', 'VALIDATED', 'APPLIED'],
    ['webhook', 'RECEIVED', 'DUPLICATE'],
  ] as const)('%s: %s → %s é legal', (agg, from, to) => {
    expect(() => assertTransition(agg, from, to)).not.toThrow();
    expect(canTransition(agg, from, to)).toBe(true);
  });

  it.each([
    ['subscription', 'DRAFT', 'PAST_DUE'],
    ['subscription', 'CANCELLED', 'ACTIVE'],
    ['subscription', 'EXPIRED', 'ACTIVE'],
    ['invoice', 'DRAFT', 'REFUNDED'],
    ['invoice', 'PAID', 'CANCELLED'],
    ['invoice', 'REFUNDED', 'PAID'],
    ['invoice', 'CANCELLED', 'PENDING'],
    ['payment', 'CONFIRMED', 'PENDING'],
    ['payment', 'CONFIRMED', 'FAILED'],
    ['payment', 'REFUNDED', 'CONFIRMED'],
    ['payment', 'CHARGEBACK', 'PENDING'],
    ['refund', 'COMPLETED', 'PROCESSING'],
    ['refund', 'PROCESSING', 'REQUESTED'],
    ['refund', 'FAILED', 'COMPLETED'],
    ['webhook', 'APPLIED', 'VALIDATED'],
    ['webhook', 'DUPLICATE', 'APPLIED'],
  ] as const)('%s: %s → %s é ilegal (nunca regride terminal)', (agg, from, to) => {
    expect(canTransition(agg, from, to)).toBe(false);
    try {
      assertTransition(agg, from, to);
      throw new Error('deveria ter lançado IllegalTransitionError');
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalTransitionError);
      expect((e as IllegalTransitionError).aggregate).toBe(agg);
    }
  });

  it('no-op (from === to) é permitido — replay idempotente', () => {
    expect(() => assertTransition('payment', 'CONFIRMED', 'CONFIRMED')).not.toThrow();
    expect(() => assertTransition('invoice', 'CANCELLED', 'CANCELLED')).not.toThrow();
  });

  it('estado desconhecido → ilegal', () => {
    expect(() => assertTransition('payment', 'MAGICA', 'CONFIRMED')).toThrow(IllegalTransitionError);
  });
});

describe('buildInvoiceNumber (INV-AAAA-NNNNNN)', () => {
  it('formato com ano + 6 dígitos', () => {
    expect(buildInvoiceNumber(2026, () => '000123')).toBe('INV-2026-000123');
    expect(buildInvoiceNumber(2026)).toMatch(/^INV-2026-\d{6}$/);
  });
  it('rejeita rand fora do padrão', () => {
    expect(() => buildInvoiceNumber(2026, () => 'abc')).toThrow();
  });
});
