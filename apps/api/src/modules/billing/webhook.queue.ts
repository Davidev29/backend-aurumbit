/**
 * Fila `billing.webhook.apply` (Fase 4, PROJECT.md §5).
 * - Produtor (webhook.controller/service, reconciliação): `jobId = eventId`
 *   (dedupe BullMQ; webhook usa `wh:asaas:*`, reconciliação `recon:*:*`).
 * - Consumidor: `apps/workers/src/queues/billing.apply.ts` → aplica via
 *   endpoint interno `POST /v1/billing/webhooks/apply`; retry exponencial
 *   5x + DLQ `billing.dlq` (replay manual preserva o eventId).
 * Driver de fila explícito (`common/queue/queue-driver.ts`, achado N1): com
 * `QUEUE_DRIVER=bullmq` a Queue é real; com `memory` (default) a fila é
 * in-memory e o driver é REGISTRADO no boot — nunca mais degradação silenciosa.
 * Em qualquer caso o ack 200 do webhook não depende do Redis (o receipt
 * RECEIVED persiste; reconciliação cobre o gap).
 */

import { z } from 'zod';
import {
  announceQueueDriver,
  createRedisConnection,
  requireBullMqQueueCtor,
} from '../../common/queue/queue-driver';

export const BILLING_WEBHOOK_QUEUE = 'billing.webhook.apply';
export const BILLING_DLQ = 'billing.dlq';

export const APPLY_MAX_ATTEMPTS = 5;
export const APPLY_BACKOFF_MS = 2000;

/** Opções de produção: retry exp + dedupe por eventId. */
export function webhookJobOptions(eventId: string): {
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

/** Envelope aceito em `billing.webhook.apply` (webhook + RECONCILIATION). */
export const WebhookJobSchema = z
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

export type WebhookJobData = z.infer<typeof WebhookJobSchema>;

export interface WebhookQueuePort {
  add(
    name: string,
    data: WebhookJobData,
    opts: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number } },
  ): Promise<unknown>;
}

export const WEBHOOK_QUEUE = 'BILLING_WEBHOOK_QUEUE';

/** No-op p/ testes/dev sem Redis (ack preservado; reconciliação cobre). */
export class InMemoryWebhookQueue implements WebhookQueuePort {
  readonly added: Array<{ name: string; data: WebhookJobData; opts: unknown }> = [];
  async add(
    name: string,
    data: WebhookJobData,
    opts: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number } },
  ): Promise<{ id: string }> {
    this.added.push({ name, data, opts });
    return { id: data.eventId };
  }
}

/**
 * Factory do provider `WEBHOOK_QUEUE`. Com `QUEUE_DRIVER=bullmq` retorna Queue
 * real (`billing.webhook.apply`); com `memory` (default) retorna no-op — o
 * controller continua 200 (PROJECT.md §5: ack <2s, nunca bloqueia).
 */
export function createWebhookQueue(): WebhookQueuePort {
  if (announceQueueDriver(BILLING_WEBHOOK_QUEUE) === 'bullmq') {
    const Ctor = requireBullMqQueueCtor<WebhookQueuePort>(BILLING_WEBHOOK_QUEUE);
    // ioredis lazy: Queue só conecta no 1º add (seguro no boot/build).
    return new Ctor(BILLING_WEBHOOK_QUEUE, { connection: createRedisConnection(BILLING_WEBHOOK_QUEUE) });
  }
  return new InMemoryWebhookQueue();
}
