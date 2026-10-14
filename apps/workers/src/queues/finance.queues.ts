// Filas do domínio finance (Fase 5). Convenções PROJECT.md §5:
// - `finance.sync`: `jobId = eventId` (envelope do outbox billing).
// - `finance.projection.compute`: `jobId = scope:ref:hash` (dedupe BullMQ;
//   polling do 202 `GET /v1/finance/projections/jobs/:jobId`).
// - Retry exponencial 5x + DLQ `finance.dlq` (replay manual preserva o id).
// - Workers nunca escrevem PG direto: aplicam via endpoints internos da
//   API (mesmo padrão `billing.apply.ts`).
// Este módulo só define nomes, opções e schemas (sem I/O). Abriga as filas
// de AMBOS os workstreams Fase 5 (sync billing→finance + projeções) para
// não duplicar o módulo do domínio.

import { z } from 'zod';

export const FINANCE_QUEUES = {
  /** Sync billing→finance (envelope do outbox, `jobId = eventId`). */
  sync: 'finance.sync',
  /** Cômputo de projeções (produtor: API 202/recompute). */
  compute: 'finance.projection.compute',
  dlq: 'finance.dlq',
} as const;

export const SYNC_MAX_ATTEMPTS = 5;
export const SYNC_BACKOFF_MS = 2000;

export const COMPUTE_MAX_ATTEMPTS = 5;
export const COMPUTE_BACKOFF_MS = 2000;

function jobOptions(jobId: string): {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: number;
  removeOnFail: number;
} {
  return {
    jobId,
    attempts: SYNC_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: SYNC_BACKOFF_MS },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}

/** Opções do sync: retry exp + dedupe por eventId. */
export function financeSyncJobOptions(eventId: string): ReturnType<typeof jobOptions> {
  return jobOptions(eventId);
}

/** Opções da projeção: retry exp + dedupe por jobId (scope:ref:hash). */
export function projectionJobOptions(jobId: string): ReturnType<typeof jobOptions> {
  return jobOptions(jobId);
}

/** jobId BullMQ p/ projeção: sempre `scope:ref:hash` (PROJECT.md §5). */
export function jobIdForProjection(scope: string, refDate: string, premisesHash: string): string {
  return `${scope}:${refDate}:${premisesHash}`;
}

/** jobId na DLQ preserva o id original p/ replay manual. */
export function financeDlqJobId(id: string): string {
  return `dlq:${id}`;
}

/** Envelope aceito em `finance.sync` (outbox billing → API interna). */
export const FinanceSyncJobSchema = z
  .object({
    eventId: z.string().min(8),
    topic: z.string().min(1),
    payload: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type FinanceSyncJobData = z.infer<typeof FinanceSyncJobSchema>;

/** Envelope aceito em `finance.projection.compute`. */
export const FinanceProjectionJobSchema = z.object({
  jobId: z.string().min(3),
  scope: z.enum(['monthly', 'quarterly', 'annual']),
  refDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tz: z.string().min(1).default('America/Sao_Paulo'),
  premisesHash: z.string().min(8),
});

export type FinanceProjectionJobData = z.infer<typeof FinanceProjectionJobSchema>;
