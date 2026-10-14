// Filas do domínio billing (Fase 4). Convenções PROJECT.md §5:
// - `jobId = eventId` em toda produção (`wh:asaas:*` p/ webhook,
//   `recon:<id>:<data>` p/ RECONCILIATION — mesmo pipeline).
// - Retry exponencial + DLQ `billing.dlq` (replay manual posterior).
// Wiring no boot (apps/workers/src/main.ts) é follow-up do orquestrador;
// este módulo só define nomes, opções e schemas (sem I/O).
// O worker (`billing.apply.ts`) nunca escreve PG direto (sem dep `pg`
// neste pacote): aplica via endpoints internos da API (mesmo padrão
// `licensing.evaluate` → POST /v1/...).

import { z } from 'zod';

export const BILLING_QUEUES = {
  apply: 'billing.webhook.apply',
  /** Alias: nome da fila `billing.webhook.apply` (workstream relay/fan-out). */
  webhookApply: 'billing.webhook.apply',
  /** Fila do tick de reconciliação (hourly <7d + daily 30d). */
  recon: 'billing.recon',
  /** Fan-out PaymentConfirmed → access/licensing/finance/notifications. */
  fanout: 'billing.fanout',
  dlq: 'billing.dlq',
} as const;

export const APPLY_MAX_ATTEMPTS = 5;
export const APPLY_BACKOFF_MS = 2000;

/** Aliases do workstream relay/fan-out (mesmos valores, sem I/O). */
export const BILLING_MAX_ATTEMPTS = APPLY_MAX_ATTEMPTS;
export const BILLING_BACKOFF_MS = APPLY_BACKOFF_MS;
export const RECON_HOURLY_MS = 60 * 60 * 1000;

/** Opções padrão: retry exp + dedupe por eventId. */
export function applyJobOptions(eventId: string): {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: number;
  removeOnFail: number;
} {
  return {
    jobId: eventId,
    attempts: APPLY_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: APPLY_BACKOFF_MS },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}

/** jobId BullMQ p/ evento: sempre o eventId (PROJECT.md §5). */
export function jobIdForEvent(eventId: string): string {
  return eventId;
}

/** Alias do workstream relay/fan-out. */
export function billingJobId(eventId: string): string {
  return jobIdForEvent(eventId);
}

/** jobId na DLQ preserva o eventId original p/ replay manual. */
export function dlqJobId(eventId: string): string {
  return `dlq:${eventId}`;
}

/** Alias do workstream relay/fan-out. */
export function billingDlqJobId(eventId: string): string {
  return dlqJobId(eventId);
}

/** Alias do workstream relay/fan-out (mesmas opções do apply). */
export function billingJobOptions(eventId: string): {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: number;
  removeOnFail: number;
} {
  return applyJobOptions(eventId);
}

/** Envelope aceito em `billing.webhook.apply` (webhook + RECONCILIATION). */
export const BillingApplyJobSchema = z
  .object({
    eventId: z.string().min(8),
    kind: z.enum(['webhook', 'reconciliation']),
    externalId: z.string().min(1),
    event: z.string().min(1).optional(),
    paymentId: z.string().min(1).optional(),
    remoteStatus: z.string().min(1).optional(),
    remoteAmountCents: z.number().int().nonnegative().optional(),
    receivedAt: z.string().min(1).optional(),
  })
  .passthrough();

export type BillingApplyJobData = z.infer<typeof BillingApplyJobSchema>;
