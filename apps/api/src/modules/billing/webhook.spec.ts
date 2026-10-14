// Testes do webhook Asaas (Fase 4, PROJECT.md §5).
// Sem PG/Redis: fakes em memória (SQL) + `InMemoryWebhookQueue`.

import { UnauthorizedException } from '@nestjs/common';
import { InMemoryWebhookQueue } from './webhook.queue';
import { BillingWebhookService, PaymentApplyPort, WebhookMetrics } from './webhook.service';
import {
  IllegalWebhookTransition,
  assertWebhookTransition,
  buildWebhookEventId,
  buildWebhookExternalId,
  parseAsaasEnvelope,
  timingSafeTokenEqual,
} from './webhook.transitions';

const SECRET = 'test-webhook-secret-32-chars-min!!!';

interface ReceiptRow {
  status: string;
  payload: unknown;
}

function makeFakeDb(
  seed: Record<string, ReceiptRow> = {},
  payments: Record<string, { status: string; amountCents: number }> = {},
) {
  const receipts = new Map<string, ReceiptRow>(Object.entries(seed));
  const pays = new Map(Object.entries(payments));
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    receipts,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO webhook_receipts')) {
        const externalId = String(params?.[2]);
        if (receipts.has(externalId)) return { rowCount: 0, rows: [] };
        receipts.set(externalId, { status: 'RECEIVED', payload: JSON.parse(String(params?.[3])) });
        return { rowCount: 1, rows: [{ id: 'r1', status: 'RECEIVED' }] };
      }
      if (sql.includes('FROM webhook_receipts')) {
        const externalId = String(params?.[1]);
        const row = receipts.get(externalId);
        if (!row) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ status: row.status, payload: row.payload }] };
      }
      if (sql.includes('UPDATE webhook_receipts SET status')) {
        if (sql.includes("SET status = 'REJECTED'")) {
          // reject(): params [provider, externalId, from]
          const [, externalId, from] = params as string[];
          const row = receipts.get(externalId);
          if (!row || (from && row.status !== from)) return { rowCount: 0, rows: [] };
          row.status = 'REJECTED';
          return { rowCount: 1, rows: [] };
        }
        // transitionReceipt(): params [to, provider, externalId, from]
        const [to, , externalId, from] = params as string[];
        const row = receipts.get(externalId);
        if (!row || (from && row.status !== from)) return { rowCount: 0, rows: [] };
        row.status = to;
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('FROM payments WHERE provider')) {
        const externalId = String(params?.[1]);
        const p = pays.get(externalId);
        if (!p) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [{ id: 'pay-db-1', status: p.status, amountCents: p.amountCents }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };
}

function makeMetrics(): WebhookMetrics & { calls: string[] } {
  const calls: string[] = [];
  return { calls, inc: (n) => void calls.push(n) };
}

function svc(
  db: ReturnType<typeof makeFakeDb>,
  queue = new InMemoryWebhookQueue(),
  metrics = makeMetrics(),
) {
  const s = new BillingWebhookService(db, queue).withMetrics(metrics);
  return { s, queue, metrics };
}

const BODY = {
  event: 'PAYMENT_CONFIRMED',
  payment: { id: 'pay_1', value: 100, confirmedDate: '2026-10-10' },
};

beforeEach(() => {
  process.env.ASAAS_WEBHOOK_SECRET = SECRET;
  delete process.env.ASAAS_IP_ALLOWLIST;
});

afterEach(() => {
  delete process.env.ASAAS_WEBHOOK_SECRET;
});

describe('parseAsaasEnvelope', () => {
  it('extrai event/paymentId e deriva externalId/eventId idempotentes', () => {
    const p = parseAsaasEnvelope(BODY);
    expect(p).toMatchObject({ event: 'PAYMENT_CONFIRMED', paymentId: 'pay_1' });
    expect(p?.externalId).toBe('PAYMENT_CONFIRMED:pay_1');
    expect(p?.eventId).toBe('wh:asaas:PAYMENT_CONFIRMED:pay_1');
    expect(buildWebhookExternalId('PAYMENT_CONFIRMED', 'pay_1')).toBe(p?.externalId);
    expect(buildWebhookEventId(p!.externalId)).toBe(p?.eventId);
  });
  it('rejeita payload sem identidade (controller → 400, sem persistir)', () => {
    expect(parseAsaasEnvelope({ event: 'X' })).toBeNull();
    expect(parseAsaasEnvelope(null)).toBeNull();
    expect(parseAsaasEnvelope({ payment: { id: 'p' } })).toBeNull();
  });
});

describe('webhook duplicate/idempotente', () => {
  it('segundo POST do mesmo evento → 200 duplicate, sem reenfileirar', async () => {
    const db = makeFakeDb();
    const { s, queue, metrics } = svc(db);
    const input = { rawBody: JSON.stringify(BODY), body: BODY, tokenHeader: SECRET, ip: '1.2.3.4' };
    const first = await s.receive(input);
    expect(first).toMatchObject({ duplicate: false, externalId: 'PAYMENT_CONFIRMED:pay_1' });
    const second = await s.receive(input);
    expect(second).toMatchObject({ duplicate: true, eventId: first.eventId });
    expect(queue.added).toHaveLength(1); // mesmo pipeline, jobId = eventId
    expect(queue.added[0].data).toMatchObject({ kind: 'webhook', eventId: first.eventId });
    expect(metrics.calls).toEqual(['billing.webhook.received', 'billing.webhook.duplicate']);
    expect(
      db.calls.some((c) => c.sql.includes('ON CONFLICT (provider, "externalId") DO NOTHING')),
    ).toBe(true);
  });
  it('token inválido → 401; segredo ausente → 503 (fail-closed)', async () => {
    const { s } = svc(makeFakeDb());
    await expect(
      s.receive({ rawBody: '{}', body: BODY, tokenHeader: 'errado', ip: 'x' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    delete process.env.ASAAS_WEBHOOK_SECRET;
    await expect(
      s.receive({ rawBody: '{}', body: BODY, tokenHeader: SECRET, ip: 'x' }),
    ).rejects.toThrow('segredo não configurado');
  });
});

describe('assertWebhookTransition (ilegal → REJECTED)', () => {
  it('RECEIVED→APPLIED direto é ilegal (exige VALIDATED no meio)', () => {
    expect(() => assertWebhookTransition('RECEIVED', 'APPLIED')).toThrow(IllegalWebhookTransition);
    expect(() => assertWebhookTransition('APPLIED', 'VALIDATED')).toThrow(IllegalWebhookTransition);
    expect(() => assertWebhookTransition('APPLIED', 'APPLIED')).toThrow(IllegalWebhookTransition);
    expect(() => assertWebhookTransition('REJECTED', 'VALIDATED')).toThrow(
      IllegalWebhookTransition,
    );
  });
  it('fluxo legal não lança; service.transitionReceipt aplica condicional', async () => {
    expect(() => assertWebhookTransition('RECEIVED', 'VALIDATED')).not.toThrow();
    expect(() => assertWebhookTransition('VALIDATED', 'APPLIED')).not.toThrow();
    const db = makeFakeDb({ 'PAYMENT_CONFIRMED:pay_1': { status: 'RECEIVED', payload: {} } });
    const { s } = svc(db);
    await expect(
      s.transitionReceipt('PAYMENT_CONFIRMED:pay_1', 'APPLIED', 'VALIDATED'),
    ).rejects.toBeInstanceOf(IllegalWebhookTransition);
    expect(await s.transitionReceipt('PAYMENT_CONFIRMED:pay_1', 'RECEIVED', 'VALIDATED')).toBe(
      true,
    );
    expect(db.receipts.get('PAYMENT_CONFIRMED:pay_1')?.status).toBe('VALIDATED');
  });
  it('evento desconhecido → REJECTED + alerta, sem tocar pagamento', async () => {
    const db = makeFakeDb({
      'WEIRD_EVENT:pay_9': {
        status: 'RECEIVED',
        payload: { body: { event: 'WEIRD_EVENT', payment: { id: 'pay_9' } } },
      },
    });
    const applied: unknown[] = [];
    const port: PaymentApplyPort = {
      apply: async (i) => (applied.push(i), { applied: true as const }),
    };
    const { s, metrics } = svc(db);
    s.withApplyPort(port);
    const out = await s.applyReceipt('WEIRD_EVENT:pay_9');
    expect(out.status).toBe('REJECTED');
    expect(db.receipts.get('WEIRD_EVENT:pay_9')?.status).toBe('REJECTED');
    expect(applied).toHaveLength(0); // sem sobrescrever domínio
    expect(metrics.calls).toContain('billing.webhook.rejected');
  });
});

describe('applyReceipt VALIDATED→APPLIED', () => {
  it('happy path: RECEIVED→VALIDATED→APPLIED via assertTransition', async () => {
    const db = makeFakeDb({
      'PAYMENT_CONFIRMED:pay_1': { status: 'RECEIVED', payload: { body: BODY } },
    });
    const seen: unknown[] = [];
    const { s, metrics } = svc(db);
    s.withApplyPort({ apply: async (i) => (seen.push(i), { applied: true as const }) });
    const out = await s.applyReceipt('PAYMENT_CONFIRMED:pay_1');
    expect(out).toMatchObject({ status: 'APPLIED' });
    expect(db.receipts.get('PAYMENT_CONFIRMED:pay_1')?.status).toBe('APPLIED');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      event: 'PAYMENT_CONFIRMED',
      target: 'CONFIRMED',
      paymentId: 'pay_1',
    });
    expect(metrics.calls).toContain('billing.webhook.applied');
    // replay de terminal → idempotente, sem reaplicar
    const again = await s.applyReceipt('PAYMENT_CONFIRMED:pay_1');
    expect(again).toMatchObject({ duplicate: true });
    expect(seen).toHaveLength(1);
  });
});

describe('applyRecon (evento sintético)', () => {
  it('payment-ausente e já-terminal viram no-op (sem retry)', async () => {
    const db = makeFakeDb({}, { pay_t: { status: 'CONFIRMED', amountCents: 100 } });
    const { s } = svc(db);
    await expect(
      s.applyRecon({
        paymentExternalId: 'pay_x',
        remoteStatus: 'CONFIRMED',
        remoteAmountCents: 100,
      }),
    ).resolves.toMatchObject({ reconciled: false, reason: 'payment-ausente' });
    await expect(
      s.applyRecon({
        paymentExternalId: 'pay_t',
        remoteStatus: 'CONFIRMED',
        remoteAmountCents: 100,
      }),
    ).resolves.toMatchObject({ reconciled: false, reason: 'já-terminal' });
  });
  it('PENDING + remoto CONFIRMED mesmo valor → reconciled via applyPort', async () => {
    const db = makeFakeDb({}, { pay_1: { status: 'PENDING', amountCents: 10000 } });
    const { s } = svc(db);
    s.withApplyPort({ apply: async () => ({ applied: true as const }) });
    const out = await s.applyRecon({
      paymentExternalId: 'pay_1',
      remoteStatus: 'RECEIVED',
      remoteAmountCents: 10000,
    });
    expect(out).toMatchObject({ reconciled: true });
  });
  it('valor divergente → no-op + alerta (sem aplicar)', async () => {
    const db = makeFakeDb({}, { pay_1: { status: 'PENDING', amountCents: 10000 } });
    let called = 0;
    const { s, metrics } = svc(db);
    s.withApplyPort({ apply: async () => (called++, { applied: true as const }) });
    const out = await s.applyRecon({
      paymentExternalId: 'pay_1',
      remoteStatus: 'CONFIRMED',
      remoteAmountCents: 9999,
    });
    expect(out).toMatchObject({ reconciled: false, reason: 'valor-divergente' });
    expect(called).toBe(0);
  });
});

describe('timing-safe', () => {
  it('igual true; diferente/tamanho/ausente false sem lançar', () => {
    expect(timingSafeTokenEqual(SECRET, SECRET)).toBe(true);
    expect(timingSafeTokenEqual('a'.repeat(SECRET.length), SECRET)).toBe(false);
    expect(timingSafeTokenEqual('curto', SECRET)).toBe(false);
    expect(timingSafeTokenEqual('', SECRET)).toBe(false);
  });
});
