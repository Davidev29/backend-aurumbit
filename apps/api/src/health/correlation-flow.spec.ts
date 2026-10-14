import { MetricsController } from './metrics.controller';
import { metricsExposition, observeHttpRequest, resetMetricsForTests } from './metrics-registry';
import { envelopeOf } from '../common/outbox/outbox-relay';
import { sanitizeAuditMetadata } from '../modules/audit/audit-record';
import { handleEmailSendJob, type EmailSenderStore, type EmailTransport } from '../modules/communications/email-sender.worker';

// Fluxo Outbox→BullMQ→Resend→Audit (Fase 6, 1 fluxo verificado — e-mail).
// Documentação completa em docs/RUNBOOKS/correlation.md.
describe('correlationId Outbox→BullMQ→Resend→Audit (fluxo e-mail)', () => {
  beforeEach(() => resetMetricsForTests());

  it('envelopeOf preserva correlationId da linha (Outbox→BullMQ)', () => {
    const env = envelopeOf({
      eventId: 'evt-corr-001',
      aggregate: 'payment',
      aggregateId: 'pay_1',
      type: 'billing.payment.confirmed.v1',
      payload: {},
      occurredAt: new Date().toISOString(),
      correlationId: 'corr-abc-123',
    });
    expect(env.correlationId).toBe('corr-abc-123');
    // jobId BullMQ = eventId (PROJECT §5)
    expect(env.eventId).toBe('evt-corr-001');
  });

  it('worker repassa correlationId como tag Resend com idempotencyKey=eventId', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const store: EmailSenderStore = {
      requestEmail: async () => ({ inserted: true, status: 'QUEUED' }),
      markSending: async () => true,
      markSent: async () => undefined,
      markFailed: async () => undefined,
    };
    const transport: EmailTransport = {
      send: async (input) => {
        seen.push({ ...input });
        return { resendId: 're_1' };
      },
    };
    const out = await handleEmailSendJob(
      {
        id: 'evt-corr-001',
        data: {
          eventId: 'evt-corr-001',
          to: 'cliente@example.com',
          template: 'payment-confirmed',
          templateVersion: 'v1',
          vars: { referenceCode: 'pay_123' },
          correlationId: 'corr-abc-123',
        },
        attemptsMade: 0,
      },
      { store, transport, moveToDlq: async () => undefined },
    );
    expect(out.status).toBe('sent');
    expect(seen[0].idempotencyKey).toBe('evt-corr-001');
    expect(seen[0].tags).toEqual([{ name: 'correlationId', value: 'corr-abc-123' }]);
  });

  it('audit preserva correlationId na allowlist de metadata', () => {
    const meta = sanitizeAuditMetadata({ eventId: 'evt-corr-001', correlationId: 'corr-abc-123' });
    expect(meta.correlationId).toBe('corr-abc-123');
  });

  it('GET /metrics ecoa x-correlation-id e contém contadores', () => {
    observeHttpRequest('GET', '/metrics', 200, 0.001);
    const ctl = new MetricsController();
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as import('express').Response;
    const body = ctl.exposition(
      { headers: { 'x-correlation-id': 'corr-abc-123' } } as unknown as import('express').Request,
      res,
    );
    expect(headers['x-correlation-id']).toBe('corr-abc-123');
    expect(typeof body).toBe('string');
    expect(body).toContain('http_requests_total');
    expect(metricsExposition()).toContain('http_requests_total');
  });

  it('GET /metrics gera correlationId quando ausente', () => {
    const ctl = new MetricsController();
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as import('express').Response;
    ctl.exposition({ headers: {} } as unknown as import('express').Request, res);
    expect(typeof headers['x-correlation-id']).toBe('string');
    expect(headers['x-correlation-id'].length).toBeGreaterThan(0);
  });
});
