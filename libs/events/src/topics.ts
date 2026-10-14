/**
 * Tópicos de eventos — Fase 1, sem negócio.
 * Convenção: `<domínio>.<entidade>.<ação>.v1` (ex. `billing.payment.confirmed.v1`).
 * - Sufixo `.v1` obrigatório; breaking change → `.v2` em tópico NOVO (nunca reutilizar).
 * - Produtores SÓ adicionam campos opcionais no payload; consumidores ignoram desconhecidos.
 * - `RECONCILIATION` (PROJECT §5) trafega pelo mesmo pipeline com `eventId=recon:<id>:<data>`.
 */

export const TOPICS = [
  // Auth / customers (Fase 2)
  "auth.user.registered.v1",
  "auth.email.verified.v1",
  "auth.session.revoked.v1",
  "auth.mfa.enabled.v1",
  "customers.organization.created.v1",
  "customers.membership.granted.v1",
  "customers.consent.recorded.v1",
  "customers.gdpr.erased.v1",
  // Products / access / licensing (Fases 2-3)
  "products.plan.published.v1",
  "access.entitlement.updated.v1",
  "licensing.license.issued.v1",
  "licensing.license.renewed.v1",
  "licensing.license.revoked.v1",
  "licensing.license.revealed.v1",
  "licensing.device.linked.v1",
  "licensing.device.clone_suspect.v1",
  "licensing.bonus.granted.v1",
  // Billing / finance (Fase 4-5)
  "billing.payment.confirmed.v1",
  "billing.payment.failed.v1",
  "billing.payment.refunded.v1",
  "billing.subscription.cancelled.v1",
  "billing.webhook.received.v1",
  "billing.reconciliation.completed.v1",
  "finance.transaction.posted.v1",
  // Communications / audit / workers (Fase 4)
  "communications.email.requested.v1",
  "communications.email.delivered.v1",
  "communications.email.failed.v1",
  "audit.security.event.v1",
  "workers.heartbeat.v1",
  "workers.dlq.moved.v1",
] as const;

export type Topic = (typeof TOPICS)[number];

export function isTopic(v: string): v is Topic {
  return (TOPICS as readonly string[]).includes(v);
}

/** Prefixo por domínio (útil p/ subscriptions e DLQ routing). */
export const TOPIC_PREFIXES = [
  "auth.",
  "customers.",
  "products.",
  "access.",
  "licensing.",
  "billing.",
  "finance.",
  "communications.",
  "audit.",
  "workers.",
] as const;
