import type { TemplateName } from './email-templates';

// Consumidor de eventos de domínio → e-mail (Fase 4).
// Mapeia `PaymentConfirmed/Failed`, `SubscriptionCancelled`, `LicenseIssued`,
// `LicenseRenewed` e `BonusGranted` para `communications.email.requested.v1`.
// Nesta fase os produtores (billing core) podem estar ausentes (workstream
// paralelo): a emissão aqui é STUB — constrói o envelope `email.requested`
// (função pura, sem I/O) a partir de eventos stub em teste; o enqueue real
// na fila `comm.email.send` é feito pelo boot dos workers (outro workstream)
// via `toSendJob`. Sem billing core, sem escrita cross-DB.

export interface DomainEventLike {
  eventId: string;
  topic: string;
  version: number;
  occurredAt: string;
  correlationId?: string;
  payload?: Record<string, unknown> | null;
}

export interface EmailRequest {
  /** Idempotente e determinístico: `email:<eventId de origem>`. */
  eventId: string;
  correlationId?: string;
  causationId: string;
  to: string;
  template: TemplateName;
  templateVersion: 'v1';
  vars: Record<string, unknown>;
}

export interface SendJobPayload {
  eventId: string;
  to: string;
  template: string;
  templateVersion: 'v1';
  vars: Record<string, unknown>;
  correlationId?: string;
}

function str(payload: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pick<T>(payload: Record<string, unknown>, key: string): T | undefined {
  const v = payload[key];
  return (v === undefined || v === null ? undefined : v) as T | undefined;
}

type Mapping = { template: TemplateName; vars: Record<string, unknown> } | { skip: string };

/**
 * Mapeia um evento de domínio → pedido de e-mail. Retorna `skip` quando:
 * - tópico sem template correspondente (ex. `payment.refunded` — fora dos 14);
 * - destinatário ausente no payload (produtor ainda não emite `email`).
 * Leitura defensiva: campos desconhecidos são ignorados, nunca lançam.
 */
export function mapDomainEventToEmailRequest(ev: DomainEventLike): { ok: true; request: EmailRequest } | { ok: false; reason: string } {
  if (!ev || typeof ev !== 'object') return { ok: false, reason: 'evento inválido' };
  const payload = (ev.payload ?? {}) as Record<string, unknown>;
  const to = str(payload, 'email', 'to', 'recipient', 'customerEmail');
  if (!to || !to.includes('@')) return { ok: false, reason: 'destinatário ausente no payload (produtor ainda não emite email)' };

  const mapped = mapTopic(ev.topic, payload);
  if ('skip' in mapped) return { ok: false, reason: mapped.skip };

  return {
    ok: true,
    request: {
      eventId: `email:${ev.eventId}`,
      correlationId: ev.correlationId,
      causationId: ev.eventId,
      to,
      template: mapped.template,
      templateVersion: 'v1',
      vars: mapped.vars,
    },
  };
}

function mapTopic(topic: string, p: Record<string, unknown>): Mapping {
  switch (topic) {
    case 'billing.payment.confirmed.v1': {
      const ref = str(p, 'referenceCode', 'paymentId', 'externalId');
      if (!ref) return { skip: 'payment.confirmed sem referenceCode' };
      return {
        template: 'payment-confirmed',
        vars: {
          referenceCode: ref,
          ...(pick<number>(p, 'amountCents') !== undefined ? { amountCents: p.amountCents } : {}),
          ...(str(p, 'currency') ? { currency: p.currency } : {}),
          ...(str(p, 'receiptUrl') ? { receiptUrl: p.receiptUrl } : {}),
        },
      };
    }
    case 'billing.payment.failed.v1': {
      const ref = str(p, 'referenceCode', 'paymentId', 'externalId');
      if (!ref) return { skip: 'payment.failed sem referenceCode' };
      return {
        template: 'payment-failed',
        vars: {
          referenceCode: ref,
          ...(str(p, 'actionUrl', 'retryUrl') ? { actionUrl: str(p, 'actionUrl', 'retryUrl') } : {}),
          ...(str(p, 'reasonCode', 'reason') ? { reasonCode: str(p, 'reasonCode', 'reason') } : {}),
        },
      };
    }
    case 'billing.subscription.cancelled.v1': {
      const plan = str(p, 'planName', 'plan');
      const effective = str(p, 'effectiveDate', 'validUntil');
      if (!plan || !effective) return { skip: 'subscription.cancelled sem planName/effectiveDate' };
      return {
        template: 'subscription-cancelled',
        vars: {
          planName: plan,
          effectiveDate: effective,
          ...(str(p, 'actionUrl', 'reactivateUrl') ? { actionUrl: str(p, 'actionUrl', 'reactivateUrl') } : {}),
        },
      };
    }
    case 'licensing.license.issued.v1': {
      const masked = str(p, 'keyMasked') ?? (str(p, 'keyLast4') ? `AURUM-••••-••••-${str(p, 'keyLast4')}` : undefined);
      const expires = str(p, 'expiresAt', 'expires');
      if (!masked || !expires) return { skip: 'license.issued sem keyMasked/expiresAt' };
      return {
        template: 'license-issued',
        vars: {
          keyMasked: masked,
          expiresAt: expires,
          ...(str(p, 'planName', 'plan') ? { planName: str(p, 'planName', 'plan') } : {}),
          ...(str(p, 'actionUrl') ? { actionUrl: p.actionUrl } : {}),
        },
      };
    }
    case 'licensing.license.renewed.v1': {
      const masked = str(p, 'keyMasked') ?? (str(p, 'keyLast4') ? `AURUM-••••-••••-${str(p, 'keyLast4')}` : undefined);
      const expires = str(p, 'expiresAt', 'expires');
      if (!masked || !expires) return { skip: 'license.renewed sem keyMasked/expiresAt' };
      return {
        template: 'license-renewed',
        vars: {
          keyMasked: masked,
          expiresAt: expires,
          ...(str(p, 'actionUrl') ? { actionUrl: p.actionUrl } : {}),
        },
      };
    }
    case 'licensing.bonus.granted.v1': {
      const benefit = str(p, 'benefitLabel', 'benefit', 'reason');
      if (!benefit) return { skip: 'bonus.granted sem benefitLabel' };
      return {
        template: 'bonus-granted',
        vars: {
          benefitLabel: benefit,
          ...(str(p, 'expiresAt') ? { expiresAt: p.expiresAt } : {}),
          ...(str(p, 'actionUrl') ? { actionUrl: p.actionUrl } : {}),
        },
      };
    }
    default:
      return { skip: `tópico sem template correspondente: ${topic}` };
  }
}

/**
 * Envelope `communications.email.requested.v1` (emit stub quando o produtor
 * real está ausente). `eventId` do envelope = `eventId` do request
 * (`email:<origem>`), logo replays do domínio colapsam no mesmo upsert.
 */
export function buildEmailRequestedEnvelope(request: EmailRequest): {
  eventId: string;
  topic: 'communications.email.requested.v1';
  version: 1;
  occurredAt: string;
  correlationId?: string;
  causationId: string;
  payload: {
    to: string;
    template: TemplateName;
    templateVersion: 'v1';
    vars: Record<string, unknown>;
  };
} {
  return {
    eventId: request.eventId,
    topic: 'communications.email.requested.v1',
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: request.correlationId,
    causationId: request.causationId,
    payload: {
      to: request.to,
      template: request.template,
      templateVersion: request.templateVersion,
      vars: request.vars,
    },
  };
}

/** Converte o request no job da fila `comm.email.send` (`jobId = eventId`). */
export function toSendJob(request: EmailRequest): SendJobPayload {
  return {
    eventId: request.eventId,
    to: request.to,
    template: request.template,
    templateVersion: request.templateVersion,
    vars: request.vars,
    correlationId: request.correlationId,
  };
}
