import {
  buildEmailRequestedEnvelope,
  mapDomainEventToEmailRequest,
  toSendJob,
  type DomainEventLike,
} from './email-consumer';

function stubEvent(topic: string, payload: Record<string, unknown>): DomainEventLike {
  return {
    eventId: 'dom-evt-001',
    topic,
    version: 1,
    occurredAt: '2026-10-10T12:00:00.000Z',
    correlationId: 'corr-abc',
    payload,
  };
}

describe('email-consumer (domínio → email.requested, stub se produtor ausente)', () => {
  it('PaymentConfirmed → payment-confirmed (eventId determinístico, correlação propagada)', () => {
    const r = mapDomainEventToEmailRequest(
      stubEvent('billing.payment.confirmed.v1', {
        email: 'pagador@example.com',
        referenceCode: 'pay_123',
        amountCents: 9990,
        currency: 'BRL',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.template).toBe('payment-confirmed');
    expect(r.request.eventId).toBe('email:dom-evt-001');
    expect(r.request.causationId).toBe('dom-evt-001');
    expect(r.request.correlationId).toBe('corr-abc');
    const env = buildEmailRequestedEnvelope(r.request);
    expect(env.topic).toBe('communications.email.requested.v1');
    expect(env.eventId).toBe('email:dom-evt-001');
    expect(env.causationId).toBe('dom-evt-001');
    const job = toSendJob(r.request);
    expect(job.eventId).toBe('email:dom-evt-001'); // jobId=eventId no enqueue
  });

  it('PaymentFailed → payment-failed', () => {
    const r = mapDomainEventToEmailRequest(
      stubEvent('billing.payment.failed.v1', { email: 'p@example.com', referenceCode: 'pay_124' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.template).toBe('payment-failed');
  });

  it('LicenseIssued monta keyMasked a partir de keyLast4 (sem plaintext)', () => {
    const r = mapDomainEventToEmailRequest(
      stubEvent('licensing.license.issued.v1', {
        email: 't@example.com',
        keyLast4: 'AB12',
        expiresAt: '2027-10-10',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.template).toBe('license-issued');
    expect(r.request.vars.keyMasked).toBe('AURUM-••••-••••-AB12');
  });

  it('LicenseRenewed e BonusGranted mapeiam p/ os templates próprios', () => {
    const ren = mapDomainEventToEmailRequest(
      stubEvent('licensing.license.renewed.v1', {
        email: 't@example.com',
        keyMasked: 'AURUM-••••-••••-CD34',
        expiresAt: '2027-10-15',
      }),
    );
    expect(ren.ok).toBe(true);
    if (ren.ok) expect(ren.request.template).toBe('license-renewed');
    const bonus = mapDomainEventToEmailRequest(
      stubEvent('licensing.bonus.granted.v1', { email: 't@example.com', benefitLabel: '+5 máquinas' }),
    );
    expect(bonus.ok).toBe(true);
    if (bonus.ok) expect(bonus.request.template).toBe('bonus-granted');
  });

  it('SubscriptionCancelled exige planName/effectiveDate', () => {
    const okRes = mapDomainEventToEmailRequest(
      stubEvent('billing.subscription.cancelled.v1', {
        email: 'a@example.com',
        planName: 'Pro mensal',
        effectiveDate: '2026-11-10',
      }),
    );
    expect(okRes.ok).toBe(true);
    const missing = mapDomainEventToEmailRequest(
      stubEvent('billing.subscription.cancelled.v1', { email: 'a@example.com' }),
    );
    expect(missing.ok).toBe(false);
  });

  it('sem destinatário no payload → skip (produtor ausente, só stub)', () => {
    const r = mapDomainEventToEmailRequest(
      stubEvent('billing.payment.confirmed.v1', { referenceCode: 'pay_123' }),
    );
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('destinatário') });
  });

  it('tópico sem template (ex. payment.refunded) → skip explícito', () => {
    const r = mapDomainEventToEmailRequest(
      stubEvent('billing.payment.refunded.v1', { email: 'a@example.com', referenceCode: 'pay_9' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('sem template');
  });

  it('mesmo evento de domínio gera sempre o mesmo email.eventId (replay colapsa no upsert)', () => {
    const ev = stubEvent('billing.payment.confirmed.v1', { email: 'a@example.com', referenceCode: 'pay_1' });
    const a = mapDomainEventToEmailRequest(ev);
    const b = mapDomainEventToEmailRequest({ ...ev });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.request.eventId).toBe(b.request.eventId);
  });
});
