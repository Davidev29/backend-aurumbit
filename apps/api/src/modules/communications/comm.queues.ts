// Filas do domínio communications (Fase 4, PROJECT.md §5).
// - `jobId = eventId` em toda produção (dedupe BullMQ).
// - Retry exponencial 5x + DLQ `comm.email.dlq` (replay manual posterior
//   preserva o eventId). Wiring no boot (apps/workers) é do workstream de
//   workers; este módulo só define nomes/opções (sem I/O) + o handler puro
//   `email-sender.worker.ts` (testável sem Redis/PG).

export const COMM_QUEUES = {
  send: 'comm.email.send',
  dlq: 'comm.email.dlq',
} as const;

export const SEND_MAX_ATTEMPTS = 5;
export const SEND_BACKOFF_MS = 2000;

/** Opções padrão do job de envio: retry exp 5x + dedupe por eventId. */
export function sendJobOptions(eventId: string): {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: number;
  removeOnFail: number;
} {
  return {
    jobId: eventId,
    attempts: SEND_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: SEND_BACKOFF_MS },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}

/** jobId na DLQ preserva o eventId original p/ replay manual. */
export function dlqJobId(eventId: string): string {
  return `dlq:${eventId}`;
}
