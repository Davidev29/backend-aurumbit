// Consumidor `billing.webhook.apply` (webhook + RECONCILIATION, Fase 4).
// - `jobId = eventId` na produção (ver billing.queues applyJobOptions).
// - Envelope inválido → DLQ direto (poison; retry não ajuda).
// - `kind=webhook` → POST /v1/billing/webhooks/apply { externalId }
//   (API executa RECEIVED→VALIDATED→APPLIED via assertTransition).
// - `kind=reconciliation` (`recon:<id>:<data>`) → POST
//   /v1/billing/webhooks/recon-apply (mesmo pipeline, outra identidade).
// - Resposta 2xx com `REJECTED`/no-op → completa sem retry (decisão de
//   negócio, não falha transitória). 404 → DLQ direto. 5xx/rede →
//   relança p/ retry exponencial; esgotados os attempts → `billing.dlq`
//   preservando o eventId original.
// - O worker nunca escreve PG direto (sem dep `pg`); HTTP injetável
//   p/ teste sem rede (mesmo padrão de `licensing.evaluate`).

import { BillingApplyJobSchema, dlqJobId } from './billing.queues';

export const APPLY_MAX_ATTEMPTS = 5;

export const APPLY_ENDPOINT = '/v1/billing/webhooks/apply';
export const RECON_APPLY_ENDPOINT = '/v1/billing/webhooks/recon-apply';

export interface BillingJobRef {
  id?: string;
  data: unknown;
  attemptsMade: number;
}

export interface HttpPostResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json?(): Promise<unknown>;
}

export type BillingHttpPost = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<HttpPostResponse>;

export function defaultBillingHttpPost(): BillingHttpPost {
  const g = globalThis as unknown as { fetch?: BillingHttpPost };
  if (typeof g.fetch !== 'function') throw new Error('fetch indisponível (Node >= 20)');
  return (url, init) => g.fetch!(url, init);
}

export interface BillingApplyDeps {
  apiBaseUrl: string;
  internalKey: string;
  post?: BillingHttpPost;
  maxAttempts?: number;
  moveToDlq: (jobId: string, data: Record<string, unknown>, reason: string) => Promise<void>;
}

export type BillingApplyOutcome =
  | { status: 'applied' | 'noop' | 'rejected' | 'duplicate'; eventId: string }
  | { status: 'dlq'; eventId: string };

function isReconEventId(eventId: string): boolean {
  return eventId.startsWith('recon:');
}

export async function handleBillingApplyJob(
  job: BillingJobRef,
  deps: BillingApplyDeps,
): Promise<BillingApplyOutcome> {
  const parsed = BillingApplyJobSchema.safeParse(job.data);
  if (!parsed.success) {
    const reason = `envelope inválido: ${parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')}`;
    const fallbackId =
      typeof job.id === 'string' && job.id.length >= 8 ? job.id : 'job-sem-eventid';
    await deps.moveToDlq(
      dlqJobId(fallbackId),
      { ...(job.data as Record<string, unknown>), eventId: fallbackId },
      reason,
    );
    return { status: 'dlq', eventId: fallbackId };
  }
  const data = parsed.data;
  const max = deps.maxAttempts ?? APPLY_MAX_ATTEMPTS;
  const post = deps.post ?? defaultBillingHttpPost();

  // Rota pelo kind (fallback: prefixo do eventId — `recon:*`).
  const isRecon = data.kind === 'reconciliation' || isReconEventId(data.eventId);
  const endpoint = isRecon ? RECON_APPLY_ENDPOINT : APPLY_ENDPOINT;
  const payload = isRecon
    ? {
        paymentExternalId: data.externalId,
        remoteStatus: data.remoteStatus,
        remoteAmountCents: data.remoteAmountCents,
      }
    : { externalId: data.externalId };

  let res: HttpPostResponse;
  try {
    res = await post(`${deps.apiBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': deps.internalKey },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Rede → retry; esgotado → DLQ.
    if (job.attemptsMade + 1 >= max) {
      await deps.moveToDlq(
        dlqJobId(data.eventId),
        { ...data },
        err instanceof Error ? err.message : String(err),
      );
      return { status: 'dlq', eventId: data.eventId };
    }
    throw err;
  }

  if (res.status === 404) {
    const text = await res.text().catch(() => '');
    await deps.moveToDlq(
      dlqJobId(data.eventId),
      { ...data },
      `apply 404 (poison): ${text.slice(0, 200)}`,
    );
    return { status: 'dlq', eventId: data.eventId };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`apply ${res.status}: ${text.slice(0, 200)}`);
    if (job.attemptsMade + 1 >= max) {
      await deps.moveToDlq(dlqJobId(data.eventId), { ...data }, err.message);
      return { status: 'dlq', eventId: data.eventId };
    }
    throw err;
  }

  const bodyText = await res.text().catch(() => '{}');
  let out: Record<string, unknown> = {};
  try {
    out = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    out = {};
  }
  if (out.status === 'REJECTED') return { status: 'rejected', eventId: data.eventId };
  if (out.duplicate === true || out.status === 'APPLIED' || out.status === 'DUPLICATE') {
    return {
      status: out.duplicate === true || out.status === 'DUPLICATE' ? 'duplicate' : 'applied',
      eventId: data.eventId,
    };
  }
  if (out.reconciled === true) return { status: 'applied', eventId: data.eventId };
  return { status: 'noop', eventId: data.eventId };
}

/**
 * Registro no boot dos workers (follow-up do orquestrador em
 * `apps/workers/src/main.ts` — este arquivo não é importado lá hoje):
 * ```ts
 * import { Queue, Worker } from 'bullmq';
 * import { BILLING_QUEUES } from './queues/billing.queues';
 * import { handleBillingApplyJob } from './queues/billing.apply';
 * const applyQueue = new Queue(BILLING_QUEUES.apply, { connection });
 * const dlqQueue = new Queue(BILLING_QUEUES.dlq, { connection });
 * new Worker(BILLING_QUEUES.apply, (job) => handleBillingApplyJob(job, {
 *   apiBaseUrl: env.API_BASE_URL, internalKey: process.env.INTERNAL_WEBHOOK_KEY!,
 *   moveToDlq: (jobId, data, reason) => { ... },
 * }), { connection, concurrency: 5 });
 * ```
 */
export const BILLING_WORKER_WIRING_TODO = 'apps/workers/src/main.ts';
