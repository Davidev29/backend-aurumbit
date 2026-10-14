// Filas do domínio licensing (Fase 3). Convenções PROJECT.md §5:
// - `jobId = eventId` em toda produção na fila sync (dedupe BullMQ).
// - Retry exponencial + DLQ `licensing.dlq` (replay manual posterior).
// - Ticker `licensing.evaluate` com repeat a cada 5min e jobId por janela.
// Wiring no boot (apps/workers/src/main.ts) é follow-up do orquestrador;
// este módulo só define nomes, opções e schemas (sem I/O).

import { z } from 'zod';

export const LICENSING_QUEUES = {
  evaluate: 'licensing.evaluate',
  sync: 'licensing.sync',
  dlq: 'licensing.dlq',
} as const;

export const EVALUATE_EVERY_MS = 5 * 60 * 1000;
export const SYNC_MAX_ATTEMPTS = 5;
export const SYNC_BACKOFF_MS = 2000;

/** Opções padrão da fila sync: retry exp + DLQ implícita via worker. */
export function syncJobOptions(eventId: string): {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: number;
  removeOnFail: number;
} {
  return {
    jobId: eventId,
    attempts: SYNC_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: SYNC_BACKOFF_MS },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}

/** Repeat do ticker: `licensing.evaluate` a cada 5min. */
export function evaluateRepeatOptions(): { repeat: { every: number } } {
  return { repeat: { every: EVALUATE_EVERY_MS } };
}

/** Envelope mínimo aceito na fila sync (validação completa no consumidor). */
export const SyncJobSchema = z
  .object({
    eventId: z.string().min(8),
    topic: z.string().min(1),
    version: z.number().int().min(1),
    occurredAt: z.string().min(1),
    payload: z.unknown(),
  })
  .passthrough();

export type SyncJobData = z.infer<typeof SyncJobSchema>;

export const EvaluateTickSchema = z.object({ window: z.string().min(1) }).passthrough();

export type EvaluateTickData = z.infer<typeof EvaluateTickSchema>;
