/**
 * Fila `finance.sync` (Fase 5, PROJECT.md §5).
 * - Produtor (fan-out billing→finance, relay): `jobId = eventId`
 *   (dedupe BullMQ; replay do mesmo evento não duplica lançamento).
 * - Consumidor: `apps/workers/src/queues/finance.sync.ts` → aplica via
 *   endpoint interno `POST /v1/finance/internal/sync`; retry exponencial
 *   5x + DLQ `finance.dlq` (replay manual preserva o eventId).
 * Driver de fila explícito (`common/queue/queue-driver.ts`, achado N1): com
 * `QUEUE_DRIVER=bullmq` a Queue é real; com `memory` (default) a fila é
 * in-memory e o driver é REGISTRADO no boot — nunca mais degradação silenciosa.
 * Em qualquer caso o relay NUNCA depende do Redis.
 */

import { z } from 'zod';
import {
  announceQueueDriver,
  createRedisConnection,
  requireBullMqQueueCtor,
} from '../../common/queue/queue-driver';

export const FINANCE_SYNC_QUEUE = 'finance.sync';
export const FINANCE_DLQ = 'finance.dlq';

export const FINANCE_SYNC_MAX_ATTEMPTS = 5;
export const FINANCE_SYNC_BACKOFF_MS = 2000;

/** Opções de produção: retry exp + dedupe por eventId. */
export function financeSyncJobOptions(eventId: string): {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: number;
  removeOnFail: number;
} {
  return {
    jobId: eventId,
    attempts: FINANCE_SYNC_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: FINANCE_SYNC_BACKOFF_MS },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}

/** Envelope aceito em `finance.sync` (espelho do outbox billing). */
export const FinanceSyncJobSchema = z
  .object({
    eventId: z.string().min(8),
    type: z.string().min(1).optional(),
    topic: z.string().min(1).optional(),
    payload: z.record(z.unknown()).optional(),
    occurredAt: z.string().min(1).optional(),
    version: z.number().int().optional(),
  })
  .passthrough();

export type FinanceSyncJobData = z.infer<typeof FinanceSyncJobSchema>;

export interface FinanceSyncQueuePort {
  add(
    name: string,
    data: FinanceSyncJobData,
    opts: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number } },
  ): Promise<unknown>;
}

export const FINANCE_SYNC_QUEUE_PORT = 'FINANCE_SYNC_QUEUE';

/** No-op p/ testes/dev sem Redis (relay persiste; reconciliação cobre). */
export class InMemoryFinanceSyncQueue implements FinanceSyncQueuePort {
  readonly added: Array<{ name: string; data: FinanceSyncJobData; opts: unknown }> = [];
  async add(
    name: string,
    data: FinanceSyncJobData,
    opts: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number } },
  ): Promise<{ id: string }> {
    this.added.push({ name, data, opts });
    return { id: data.eventId };
  }
}

/**
 * Factory do provider `FINANCE_SYNC_QUEUE_PORT`. Com `QUEUE_DRIVER=bullmq`
 * retorna Queue real (`finance.sync`); com `memory` (default) retorna no-op.
 */
export function createFinanceSyncQueue(): FinanceSyncQueuePort {
  if (announceQueueDriver(FINANCE_SYNC_QUEUE) === 'bullmq') {
    const Ctor = requireBullMqQueueCtor<FinanceSyncQueuePort>(FINANCE_SYNC_QUEUE);
    // ioredis lazy: Queue só conecta no 1º add (seguro no boot/build).
    return new Ctor(FINANCE_SYNC_QUEUE, { connection: createRedisConnection(FINANCE_SYNC_QUEUE) });
  }
  return new InMemoryFinanceSyncQueue();
}
