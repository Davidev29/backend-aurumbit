// Consumidor billing.webhook.apply (Fase 4, PROJECT.md §5).
// - `jobId = eventId` na produção (ver billingJobOptions).
// - Envelope inválido → DLQ direto (poison; retry não ajuda).
// - Falha transitória → relança p/ retry exponencial; esgotados os attempts
//   → move p/ `billing.dlq` preservando o eventId original (replay manual).
// - Efeito real (BillingFlowService.applyAsaasWebhook / BillingService) é
//   injetado via `applyEnvelope` (POST interno idempotente na API); este
//   handler é testável sem Redis/PG.
// - Métricas `billing.webhook.*` a cada desfecho.

import { z } from 'zod';
import { BILLING_MAX_ATTEMPTS, billingDlqJobId } from './billing.queues';
import { billingMetricInc } from './billing.metrics';

const BillingWebhookEnvelope = z
  .object({
    eventId: z.string().min(8),
    topic: z.string().min(1),
    version: z.number().int().min(1).default(1),
    occurredAt: z.string().min(1),
    payload: z.unknown(),
  })
  .passthrough();

export type BillingWebhookEnvelope = z.infer<typeof BillingWebhookEnvelope>;

export interface BillingWebhookJobRef {
  id?: string;
  data: unknown;
  attemptsMade: number;
}

export interface BillingWebhookDeps {
  maxAttempts?: number;
  applyEnvelope: (env: BillingWebhookEnvelope) => Promise<{ duplicate?: boolean } | void>;
  moveToDlq: (jobId: string, data: BillingWebhookEnvelope, reason: string) => Promise<void>;
}

export type BillingWebhookOutcome =
  | { status: 'applied' | 'duplicate' | 'dlq'; eventId: string };

export async function handleBillingWebhookJob(
  job: BillingWebhookJobRef,
  deps: BillingWebhookDeps,
): Promise<BillingWebhookOutcome> {
  billingMetricInc('billing.webhook.received');
  const parsed = BillingWebhookEnvelope.safeParse(job.data);
  if (!parsed.success) {
    const reason = `envelope inválido: ${parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')}`;
    const fallback: BillingWebhookEnvelope = {
      eventId: typeof job.id === 'string' && job.id.length >= 8 ? job.id : 'job-sem-eventid',
      topic: 'unknown',
      version: 1,
      occurredAt: new Date().toISOString(),
      payload: job.data,
    };
    await deps.moveToDlq(billingDlqJobId(fallback.eventId), fallback, reason);
    billingMetricInc('billing.webhook.dlq');
    return { status: 'dlq', eventId: fallback.eventId };
  }
  const env = parsed.data;
  try {
    const r = await deps.applyEnvelope(env);
    const duplicate = typeof r === 'object' && r !== null && (r as { duplicate?: boolean }).duplicate === true;
    billingMetricInc(duplicate ? 'billing.webhook.duplicate' : 'billing.webhook.applied');
    return { status: duplicate ? 'duplicate' : 'applied', eventId: env.eventId };
  } catch (err) {
    const max = deps.maxAttempts ?? BILLING_MAX_ATTEMPTS;
    if (job.attemptsMade + 1 >= max) {
      await deps.moveToDlq(billingDlqJobId(env.eventId), env, err instanceof Error ? err.message : String(err));
      billingMetricInc('billing.webhook.dlq');
      return { status: 'dlq', eventId: env.eventId };
    }
    throw err;
  }
}
