// Consumidor licensing.sync (consome outbox licensing/access via fila).
// - `jobId = eventId` na produção (ver licensing.queues syncJobOptions).
// - Envelope inválido → DLQ direto (poison; retry não ajuda).
// - Falha transitória → relança p/ retry exponencial; esgotados os attempts
//   → move p/ `licensing.dlq` preservando o eventId original.
// - Efeito real (upsert entitlement + outbox + cache) é injetado via
//   `applyEnvelope` (ex.: LicensingSyncService.handleEnvelope na API), então
//   este handler é testável sem Redis/PG.

import { z } from 'zod';

export const SYNC_MAX_ATTEMPTS = 5;

const EnvelopeSchema = z
  .object({
    eventId: z.string().min(8),
    topic: z.string().min(1),
    version: z.number().int().min(1).default(1),
    occurredAt: z.string().min(1),
    payload: z.unknown(),
  })
  .passthrough();

export type SyncEnvelope = z.infer<typeof EnvelopeSchema>;

/** jobId BullMQ p/ evento: sempre o eventId (PROJECT.md §5). */
export function jobIdForEvent(eventId: string): string {
  return eventId;
}

/** jobId na DLQ preserva o eventId original p/ replay manual. */
export function dlqJobId(eventId: string): string {
  return `dlq:${eventId}`;
}

export function routeSyncTopic(topic: string): 'license' | 'device' | 'unknown' {
  if (topic.startsWith('licensing.license.')) return 'license';
  if (topic.startsWith('licensing.device.')) return 'device';
  return 'unknown';
}

export interface SyncJobRef {
  id?: string;
  data: unknown;
  attemptsMade: number;
}

export interface SyncHandlerDeps {
  maxAttempts?: number;
  applyEnvelope: (env: SyncEnvelope) => Promise<{ duplicate?: boolean } | void>;
  moveToDlq: (jobId: string, data: SyncEnvelope, reason: string) => Promise<void>;
}

export type SyncOutcome = { status: 'applied' | 'duplicate' | 'dlq'; eventId: string };

export async function handleSyncJob(job: SyncJobRef, deps: SyncHandlerDeps): Promise<SyncOutcome> {
  const parsed = EnvelopeSchema.safeParse(job.data);
  if (!parsed.success) {
    const reason = `envelope inválido: ${parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')}`;
    const fallback: SyncEnvelope = {
      eventId: typeof job.id === 'string' && job.id.length >= 8 ? job.id : 'job-sem-eventid',
      topic: 'unknown',
      version: 1,
      occurredAt: new Date().toISOString(),
      payload: job.data,
    };
    await deps.moveToDlq(dlqJobId(fallback.eventId), fallback, reason);
    return { status: 'dlq', eventId: fallback.eventId };
  }
  const env = parsed.data;
  try {
    const r = await deps.applyEnvelope(env);
    const duplicate = typeof r === 'object' && r !== null && (r as { duplicate?: boolean }).duplicate === true;
    return { status: duplicate ? 'duplicate' : 'applied', eventId: env.eventId };
  } catch (err) {
    const max = deps.maxAttempts ?? SYNC_MAX_ATTEMPTS;
    if (job.attemptsMade + 1 >= max) {
      await deps.moveToDlq(dlqJobId(env.eventId), env, err instanceof Error ? err.message : String(err));
      return { status: 'dlq', eventId: env.eventId };
    }
    throw err;
  }
}
