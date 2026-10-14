// Consumidor `finance.projection.compute` + ticker de invalidação (Fase 5).
// - Fila `finance.projection.compute` (lado API/produtor em
//   `apps/api/src/modules/finance/projections.queue.ts`): `jobId =
//   scope:ref:hash` na produção (dedupe BullMQ; polling do 202 por jobId).
// - Envelope inválido → DLQ direto (poison; retry não ajuda).
// - Aplica via `POST /v1/finance/projections/internal/compute`
//   (`x-internal-key`); a API faz upsert idempotente do snapshot, então o
//   replay é no-op seguro. 404 → DLQ direto. 5xx/rede → relança p/ retry
//   exponencial; esgotados os attempts → `finance.dlq` preservando o jobId.
// - Ticker `runProjectionInvalidationTick` (safety net; a invalidação
//   primária é por evento via `POST .../internal/transaction-posted`,
//   emitido a cada FinanceTransactionPosted): invalida snapshots do período
//   corrente para que a próxima leitura recompute sob premissas frescas.
// - O worker nunca escreve PG direto (sem dep `pg`); HTTP injetável
//   p/ teste sem rede (mesmo padrão de `finance.sync`/`billing.apply`).
// - Métricas `finance.projection.*` a cada desfecho.

import { z } from 'zod';
import { financeMetricInc } from './finance.metrics';

export const FINANCE_PROJECTION_QUEUE = 'finance.projection.compute';

export const PROJECTION_COMPUTE_ENDPOINT = '/v1/finance/projections/internal/compute';
export const PROJECTION_INVALIDATE_ENDPOINT = '/v1/finance/projections/internal/transaction-posted';

export const FINANCE_PROJECTION_MAX_ATTEMPTS = 5;
export const FINANCE_PROJECTION_BACKOFF_MS = 2000;

/** Ticker de invalidação (safety net): default 60min, override por env. */
export const PROJECTION_INVALIDATION_MS = Number(
  process.env.FINANCE_PROJECTION_INVALIDATION_MS ?? 60 * 60 * 1000,
);

/** Opções padrão: retry exp + dedupe por jobId (scope:ref:hash). */
export function projectionJobOptions(jobId: string): {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: number;
  removeOnFail: number;
} {
  return {
    jobId,
    attempts: FINANCE_PROJECTION_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: FINANCE_PROJECTION_BACKOFF_MS },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}

/** jobId na DLQ preserva o jobId original p/ replay manual. */
export function projectionDlqJobId(jobId: string): string {
  return `dlq:${jobId}`;
}

/** Envelope aceito em `finance.projection.compute` (espelho do produtor API). */
export const FinanceProjectionJobSchema = z
  .object({
    jobId: z.string().min(3),
    scope: z.enum(['monthly', 'quarterly', 'annual']),
    refDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    tz: z.string().min(1).default('America/Sao_Paulo'),
    premisesHash: z.string().min(8),
  })
  .passthrough();

export type FinanceProjectionJobData = z.infer<typeof FinanceProjectionJobSchema>;

export interface FinanceProjectionJobRef {
  id?: string;
  data: unknown;
  attemptsMade: number;
}

export interface FinanceHttpPostResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FinanceProjectionHttpPost = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<FinanceHttpPostResponse>;

export function defaultProjectionHttpPost(): FinanceProjectionHttpPost {
  const g = globalThis as unknown as { fetch?: FinanceProjectionHttpPost };
  if (typeof g.fetch !== 'function') throw new Error('fetch indisponível (Node >= 20)');
  return (url, init) => g.fetch!(url, init);
}

export interface FinanceProjectionDeps {
  apiBaseUrl: string;
  internalKey: string;
  post?: FinanceProjectionHttpPost;
  maxAttempts?: number;
  moveToDlq: (jobId: string, data: Record<string, unknown>, reason: string) => Promise<void>;
}

export type FinanceProjectionOutcome =
  | { status: 'applied' | 'duplicate'; jobId: string }
  | { status: 'dlq'; jobId: string };

export async function handleFinanceProjectionJob(
  job: FinanceProjectionJobRef,
  deps: FinanceProjectionDeps,
): Promise<FinanceProjectionOutcome> {
  financeMetricInc('finance.projection.requested');
  const parsed = FinanceProjectionJobSchema.safeParse(job.data);
  if (!parsed.success) {
    const reason = `envelope inválido: ${parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')}`;
    const fallbackId =
      typeof job.id === 'string' && job.id.length >= 3 ? job.id : 'job-sem-jobid';
    await deps.moveToDlq(
      projectionDlqJobId(fallbackId),
      { ...(job.data as Record<string, unknown>), jobId: fallbackId },
      reason,
    );
    financeMetricInc('finance.projection.dlq');
    return { status: 'dlq', jobId: fallbackId };
  }
  const data = parsed.data;
  const max = deps.maxAttempts ?? FINANCE_PROJECTION_MAX_ATTEMPTS;
  const post = deps.post ?? defaultProjectionHttpPost();

  let res: FinanceHttpPostResponse;
  try {
    res = await post(`${deps.apiBaseUrl}${PROJECTION_COMPUTE_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': deps.internalKey },
      body: JSON.stringify({ scope: data.scope, refDate: data.refDate, tz: data.tz }),
    });
  } catch (err) {
    // Rede → retry; esgotado → DLQ.
    if (job.attemptsMade + 1 >= max) {
      await deps.moveToDlq(
        projectionDlqJobId(data.jobId),
        { ...data },
        err instanceof Error ? err.message : String(err),
      );
      financeMetricInc('finance.projection.dlq');
      return { status: 'dlq', jobId: data.jobId };
    }
    throw err;
  }

  if (res.status === 404) {
    const text = await res.text().catch(() => '');
    await deps.moveToDlq(
      projectionDlqJobId(data.jobId),
      { ...data },
      `compute 404 (poison): ${text.slice(0, 200)}`,
    );
    financeMetricInc('finance.projection.dlq');
    return { status: 'dlq', jobId: data.jobId };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`compute ${res.status}: ${text.slice(0, 200)}`);
    if (job.attemptsMade + 1 >= max) {
      await deps.moveToDlq(projectionDlqJobId(data.jobId), { ...data }, err.message);
      financeMetricInc('finance.projection.dlq');
      return { status: 'dlq', jobId: data.jobId };
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
  // Upsert idempotente na API: replay do mesmo jobId é no-op seguro.
  if (out.status === 'DUPLICATE' || out.duplicate === true) {
    financeMetricInc('finance.projection.duplicate');
    return { status: 'duplicate', jobId: data.jobId };
  }
  financeMetricInc('finance.projection.computed');
  return { status: 'applied', jobId: data.jobId };
}

export interface ProjectionInvalidationDeps {
  apiBaseUrl: string;
  internalKey: string;
  post?: FinanceProjectionHttpPost;
  /** ISO do instante de referência (default: agora). */
  occurredAt?: string;
}

/**
 * Ticker de invalidação de snapshots (safety net do cache de projeções).
 * POST `internal/transaction-posted` com o instante corrente → a API
 * invalida snapshots cujo período o contém; a próxima leitura recomputa
 * (hit → 200; miss pesado → 202 + jobId). Erro → relança p/ o agendador
 * registrar (o próximo tick tenta de novo; sem DLQ: invalidação é
 * reconstrutível e nunca perde efeito econômico).
 */
export async function runProjectionInvalidationTick(
  deps: ProjectionInvalidationDeps,
): Promise<{ invalidated: number }> {
  const post = deps.post ?? defaultProjectionHttpPost();
  const occurredAt = deps.occurredAt ?? new Date().toISOString();
  const res = await post(`${deps.apiBaseUrl}${PROJECTION_INVALIDATE_ENDPOINT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': deps.internalKey },
    body: JSON.stringify({ occurredAt }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`invalidate ${res.status}: ${text.slice(0, 200)}`);
  }
  const bodyText = await res.text().catch(() => '{}');
  let out: Record<string, unknown> = {};
  try {
    out = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    out = {};
  }
  const invalidated = typeof out.invalidated === 'number' ? out.invalidated : 0;
  financeMetricInc('finance.projection.invalidated', Math.max(invalidated, 0));
  return { invalidated };
}
