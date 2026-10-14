import { z } from 'zod';

// Filas da automação financeira (PROJECT.md §5):
// - `finance.bill-pay`: `jobId = finance:bill-pay:<idempotencyKey>`;
// - `finance.auto-charge`: `jobId = finance:auto-charge:<idempotencyKey>`;
// - Retry exponencial 5x + DLQ `finance.dlq` (replay manual preserva o id).
// - Workers nunca escrevem PG direto: aplicam via endpoints internos da
//   API (`POST /v1/finance/internal/automation/...`).

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

function loadBullMQCtor(): (new (
  name: string,
  opts: { connection: unknown },
) => {
  add(name: string, data: unknown, opts: unknown): Promise<unknown>;
}) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('bullmq') as {
      Queue?: new (name: string, opts: { connection: unknown }) => {
        add(name: string, data: unknown, opts: unknown): Promise<unknown>;
      };
    };
    return mod?.Queue ?? null;
  } catch {
    return null;
  }
}

class BullMQFinanceAutomationQueue implements FinanceAutomationQueuePort {
  private readonly queues = new Map<string, { add(n: string, d: unknown, o: unknown): Promise<unknown> }>();

  private q(queue: string): { add(n: string, d: unknown, o: unknown): Promise<unknown> } {
    const existing = this.queues.get(queue);
    if (existing) return existing;
    const Ctor = loadBullMQCtor();
    if (!Ctor) throw new Error('bullmq indisponível');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require('ioredis');
    const connection = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    connection.on('error', () => undefined);
    const q = new Ctor(queue, { connection });
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
 * Factory do provider `FINANCE_AUTOMATION_QUEUE_PORT`. Com `REDIS_URL` +
 * bullmq instalado retorna Queues reais; senão, no-op (inline já executou).
 */
export function createFinanceAutomationQueue(): FinanceAutomationQueuePort {
  if (process.env.REDIS_URL && loadBullMQCtor()) {
    try {
      return new BullMQFinanceAutomationQueue();
    } catch {
      return new InMemoryFinanceAutomationQueue();
    }
  }
  return new InMemoryFinanceAutomationQueue();
}
