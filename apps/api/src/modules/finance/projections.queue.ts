/**
 * Projeções — fila `finance.projection.compute` (Fase 5, lado API/produtor).
 * - `jobId = scope:ref:hash` (dedupe BullMQ; polling do 202 por jobId).
 * - Retry exponencial 5x + DLQ `finance.dlq` (replay preserva o jobId).
 * Sem import estático de `bullmq` (apps/api não o declara): factory tenta
 * `require('bullmq')` e cai p/ in-memory com warn quando ausente — o 202
 * NUNCA depende do Redis (o snapshot é recomputado inline no próximo GET
 * ou via endpoint interno). Mesmo padrão de `webhook.queue.ts`.
 */

import { z } from 'zod';

export const FINANCE_PROJECTION_QUEUE = 'finance.projection.compute';
export const FINANCE_DLQ = 'finance.dlq';

export const COMPUTE_MAX_ATTEMPTS = 5;
export const COMPUTE_BACKOFF_MS = 2000;

/** jobId BullMQ p/ projeção: sempre scope:ref:hash (PROJECT.md §5). */
export function projectionJobId(scope: string, refDate: string, premisesHash: string): string {
  return `${scope}:${refDate}:${premisesHash}`;
}

export function projectionJobOptions(jobId: string): {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: number;
  removeOnFail: number;
} {
  return {
    jobId,
    attempts: COMPUTE_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: COMPUTE_BACKOFF_MS },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}

/** Envelope aceito em `finance.projection.compute`. */
export const FinanceProjectionJobSchema = z.object({
  jobId: z.string().min(3),
  scope: z.enum(['monthly', 'quarterly', 'annual']),
  refDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tz: z.string().min(1).default('America/Sao_Paulo'),
  premisesHash: z.string().min(8),
});

export type FinanceProjectionJobData = z.infer<typeof FinanceProjectionJobSchema>;

export interface ProjectionQueuePort {
  add(
    name: string,
    data: FinanceProjectionJobData,
    opts: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number } },
  ): Promise<{ id: string }>;
}

export const PROJECTION_QUEUE = 'FINANCE_PROJECTION_QUEUE';

/** Produtor em memória (testes/dev sem Redis; registra p/ inspeção). */
export class InMemoryProjectionQueue implements ProjectionQueuePort {
  readonly added: Array<{ name: string; data: FinanceProjectionJobData; opts: unknown }> = [];
  async add(
    name: string,
    data: FinanceProjectionJobData,
    opts: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number } },
  ): Promise<{ id: string }> {
    this.added.push({ name, data, opts });
    return { id: data.jobId };
  }
}

function loadBullMQQueueCtor():
  (new (name: string, opts: { connection: unknown }) => ProjectionQueuePort) | null {
  try {
    // require lazy p/ não quebrar `nest build` sem a dep (ver topo).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('bullmq') as {
      Queue?: new (name: string, opts: { connection: unknown }) => ProjectionQueuePort;
    };
    return mod?.Queue ?? null;
  } catch {
    return null;
  }
}

export function createProjectionQueue(): ProjectionQueuePort {
  const Ctor = process.env.REDIS_URL ? loadBullMQQueueCtor() : null;
  if (Ctor) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require('ioredis');
    const connection = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    connection.on('error', () => undefined);
    return new Ctor(FINANCE_PROJECTION_QUEUE, { connection });
  }
  return new InMemoryProjectionQueue();
}
