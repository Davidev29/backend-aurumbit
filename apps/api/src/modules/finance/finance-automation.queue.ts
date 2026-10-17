import { z } from 'zod';
import {
  announceQueueDriver,
  createRedisConnection,
  requireBullMqQueueCtor,
} from '../../common/queue/queue-driver';

// Filas da automação financeira (PROJECT.md §5):
// - `finance.bill-pay`: `jobId = finance:bill-pay:<idempotencyKey>`;
// - `finance.auto-charge`: `jobId = finance:auto-charge:<idempotencyKey>`;
// - Retry exponencial 5x + DLQ `finance.dlq` (replay manual preserva o id).
// - Workers nunca escrevem PG direto: aplicam via endpoints internos da
//   API (`POST /v1/finance/internal/automation/...`).
// - Driver explícito (`common/queue/queue-driver.ts`, achado N1): o no-op
//   in-memory só vale no default `QUEUE_DRIVER=memory`; com `bullmq` as
//   Queues são reais e o driver é registrado no boot.

export const FINANCE_AUTOMATION_QUEUES = {
  billPay: 'finance.bill-pay',
  autoCharge: 'finance.auto-charge',
  dlq: 'finance.dlq',
} as const;

export const AUTOMATION_MAX_ATTEMPTS = 5;
export const AUTOMATION_BACKOFF_MS = 2000;

export function billPayJobOptions(idempotencyKey: string): {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: number;
  removeOnFail: number;
} {
  return {
    jobId: `finance:bill-pay:${idempotencyKey}`,
    attempts: AUTOMATION_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: AUTOMATION_BACKOFF_MS },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}

export function autoChargeJobOptions(idempotencyKey: string): {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: number;
  removeOnFail: number;
} {
  return {
    jobId: `finance:auto-charge:${idempotencyKey}`,
    attempts: AUTOMATION_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: AUTOMATION_BACKOFF_MS },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}

export function financeAutomationDlqJobId(id: string): string {
  return `dlq:${id}`;
}

/** Envelope aceito em `finance.bill-pay` / `finance.auto-charge`. */
export const FinanceAutomationJobSchema = z
  .object({
    idempotencyKey: z.string().min(8),
    orgId: z.string().min(1),
  })
  .passthrough();

export type FinanceAutomationJobData = z.infer<typeof FinanceAutomationJobSchema>;

// -- Porta de produção (API → BullMQ) --------------------------------------
// Mesmo padrão de `sync.queue.ts`: sem import estático de `bullmq`
// (factory tenta `require` e cai p/ no-op com warn quando ausente —
// o inline já executou; o worker é follow-up, nunca obrigatório).

export const FINANCE_AUTOMATION_QUEUE_PORT = 'FINANCE_AUTOMATION_QUEUE';

export interface FinanceAutomationQueuePort {
  add(
    queue: 'finance.bill-pay' | 'finance.auto-charge',
    name: string,
    data: Record<string, unknown>,
    opts: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number }; delay?: number },
  ): Promise<unknown>;
}

/** No-op p/ testes/dev sem Redis (inline já executou; reconciliação cobre). */
export class InMemoryFinanceAutomationQueue implements FinanceAutomationQueuePort {
  readonly added: Array<{ queue: string; name: string; data: Record<string, unknown>; opts: unknown }> = [];
  async add(
    queue: 'finance.bill-pay' | 'finance.auto-charge',
    name: string,
    data: Record<string, unknown>,
    opts: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number }; delay?: number },
  ): Promise<{ id: string }> {
    this.added.push({ queue, name, data, opts });
    return { id: String(opts.jobId) };
  }
}

type BullMqQueueLike = { add(name: string, data: unknown, opts: unknown): Promise<unknown> };

class BullMQFinanceAutomationQueue implements FinanceAutomationQueuePort {
  private readonly queues = new Map<string, BullMqQueueLike>();

  private q(queue: string): BullMqQueueLike {
    const existing = this.queues.get(queue);
    if (existing) return existing;
    const Ctor = requireBullMqQueueCtor<BullMqQueueLike>(queue);
    const q = new Ctor(queue, { connection: createRedisConnection(queue) });
    this.queues.set(queue, q);
    return q;
  }

  async add(
    queue: 'finance.bill-pay' | 'finance.auto-charge',
    name: string,
    data: Record<string, unknown>,
    opts: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number }; delay?: number },
  ): Promise<unknown> {
    return this.q(queue).add(name, data, opts);
  }
}

/**
 * Factory do provider `FINANCE_AUTOMATION_QUEUE_PORT`. Com
 * `QUEUE_DRIVER=bullmq` retorna Queues reais; com `memory` (default) retorna
 * no-op (inline já executou).
 */
export function createFinanceAutomationQueue(): FinanceAutomationQueuePort {
  if (announceQueueDriver('finance.automation') === 'bullmq') {
    return new BullMQFinanceAutomationQueue();
  }
  return new InMemoryFinanceAutomationQueue();
}
