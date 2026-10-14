// Consumidor licensing.issue (Fase 8) — node:test, sem jest.
// Roda via ts-node: `npm run test --workspace=@aurum-bit/workers` (ver package.json).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleLicensingIssueJob } from './licensing.issue';

function deps(over: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  return {
    calls,
    deps: {
      apiBaseUrl: 'http://api:3000',
      internalKey: 'k',
      moveToDlq: async () => undefined,
      get: async (url: string) => {
        calls.push({ url, method: 'GET' });
        if (url.includes('/issue-context/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              payment: { id: 'pay-1', externalId: 'ext-1', amountCents: 119900, status: 'CONFIRMED', paidAt: '2026-10-14T12:00:00.000Z' },
              invoice: { orderId: 'ord-1', productId: 'prod-base', planRef: 'AURUM_BASE_YEAR', billingInterval: 'YEAR', status: 'PAID' },
              ownerUserId: 'cus-1',
            }),
          };
        }
        if (url.includes('/v1/plans/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ features: [{ featureCode: 'OFFLINE_ACCESS', channel: 'BOTH' }] }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      },
      post: async (url: string, init: { body?: string }) => {
        calls.push({ url, method: 'POST', body: init.body });
        return { ok: true, status: 201, text: async () => JSON.stringify({ duplicate: false, license: { id: 'lic-9' } }) };
      },
      ...over,
    } as never,
  };
}

const envelope = (payload: Record<string, unknown> = {}) => ({
  eventId: 'evt-confirmed-0001',
  topic: 'billing.payment.confirmed.v1',
  version: 1,
  occurredAt: '2026-10-14T12:00:00.000Z',
  payload: { paymentId: 'pay-1', ...payload },
});

describe('handleLicensingIssueJob (Fase 8)', () => {
  it('CONFIRMED → contexto + plano + issue (issued com licenseId)', async () => {
    const { calls, deps: d } = deps();
    const out = await handleLicensingIssueJob({ data: envelope(), attemptsMade: 0 }, d);
    assert.deepEqual(out, { status: 'issued', eventId: 'evt-confirmed-0001', licenseId: 'lic-9' });
    const issue = calls.find((c) => c.method === 'POST');
    const body = JSON.parse(issue?.body ?? '{}') as Record<string, unknown>;
    assert.equal(body.billingInterval, 'YEAR');
    assert.equal(body.paidAt, '2026-10-14T12:00:00.000Z');
    assert.deepEqual(body.features, [{ code: 'OFFLINE_ACCESS', channel: 'BOTH' }]);
  });

  it('replay (duplicate:true) → status duplicate sem 2ª licença', async () => {
    const { deps: d } = deps({
      post: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ duplicate: true }) }),
    });
    const out = await handleLicensingIssueJob({ data: envelope(), attemptsMade: 0 }, d);
    assert.deepEqual(out, { status: 'duplicate', eventId: 'evt-confirmed-0001' });
  });

  it('envelope inválido → DLQ direto', async () => {
    let dlq = '';
    const { deps: d } = deps({ moveToDlq: async (id: string) => { dlq = id; } });
    const out = await handleLicensingIssueJob({ data: { nope: 1 }, attemptsMade: 0 }, d);
    assert.equal(out.status, 'dlq');
    assert.match(dlq, /^dlq:/);
  });

  it('pagamento não-CONFIRMED → DLQ (poison, sem retry útil)', async () => {
    let dlqReason = '';
    const { deps: d } = deps({
      get: async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({
          payment: { id: 'pay-1', externalId: 'ext-1', amountCents: 1, status: 'PENDING', paidAt: null },
          invoice: { orderId: 'ord-1', productId: 'p', planRef: null, billingInterval: 'MONTH', status: 'PENDING' },
          ownerUserId: 'cus-1',
        }),
      }),
      moveToDlq: async (_id: string, _d: unknown, reason: string) => { dlqReason = reason; },
    });
    const out = await handleLicensingIssueJob({ data: envelope(), attemptsMade: 0 }, d);
    assert.equal(out.status, 'dlq');
    assert.match(dlqReason, /sem paidAt/);
  });

  it('rede falha → relança p/ retry; esgotado → DLQ', async () => {
    const { deps: d } = deps({
      get: async () => { throw new Error('rede fora'); },
      moveToDlq: async () => undefined,
    });
    await assert.rejects(() => handleLicensingIssueJob({ data: envelope(), attemptsMade: 0 }, d), /rede fora/);
    const out = await handleLicensingIssueJob({ data: envelope(), attemptsMade: 4 }, d);
    assert.equal(out.status, 'dlq');
  });
});
