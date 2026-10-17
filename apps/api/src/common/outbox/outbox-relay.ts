// Relay Outbox → BullMQ por domínio (Fase 4, PROJECT.md §5).
// Puro quanto a SQL + orquestração injetável (sem PG/Redis direto): o ticker
// real (workers `outbox.relay` / cron) injeta `db` (Pool PG do domínio) e
// `queue` (BullMQ). Convenções:
// - Claim em lote: `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 100` dentro de
//   transação (2 relays nunca publicam o mesmo evento).
// - Publicação: `queue.add(type, envelope, { jobId: eventId })` — dedupe BullMQ.
// - Marca `published = true` SÓ após enfileirar (crash antes = republica; o
//   consumidor idempotente descarta o replay).
// - Resiliência POR LINHA: `queue.add` que lança (jobId inválido, Redis fora,
//   payload problemático) NÃO aborta o tick; a linha fica `published = false`
//   (o próximo tick retenta; jobId=eventId → dedupe) e sai em `failedEventIds`.
// - Purge 30d: `DELETE` SÓ de publicados — TODO job agendado (ver RUNBOOK
//   billing §5; nunca purge de não-publicado).

export interface OutboxClaimRow {
  eventId: string;
  aggregate: string;
  aggregateId: string;
  type: string;
  payload: unknown;
  occurredAt: string;
  /** Fase 6 (opcional, aditivo): correlação Outbox→BullMQ (REQUIREMENTS §4). */
  correlationId?: string;
}

export interface RelaySqlRunner {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }>;
}

export interface RelayQueue {
  add(type: string, envelope: Record<string, unknown>, opts: { jobId: string }): Promise<unknown>;
}

export const OUTBOX_RELAY_BATCH = 100;
export const OUTBOX_RELAY_TABLE = 'outbox_events';

/** Domínios com `outbox_events` próprio (1 DB por domínio, PROJECT.md). */
export const OUTBOX_RELAY_DOMAINS = [
  'auth',
  'customers',
  'products',
  'access',
  'licensing',
  'billing',
  'finance',
  'audit',
  'communications',
] as const;

/** Lote não-publicado mais antigo primeiro; trava só linhas livres. */
export function buildClaimBatchSql(table = OUTBOX_RELAY_TABLE, limit = OUTBOX_RELAY_BATCH): string {
  return (
    `SELECT "eventId", aggregate, "aggregateId", type, payload, "occurredAt"` +
    ` FROM ${table} WHERE published = false` +
    ` ORDER BY "occurredAt" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`
  );
}

export function buildMarkPublishedSql(table = OUTBOX_RELAY_TABLE): string {
  return `UPDATE ${table} SET published = true WHERE "eventId" = ANY($1)`;
}

/** Purge SÓ de publicados com 30d — TODO job agendado (nunca manual ad-hoc). */
export function buildPurgeSql(table = OUTBOX_RELAY_TABLE): string {
  return `DELETE FROM ${table} WHERE published = true AND "occurredAt" < now() - interval '30 days'`;
}

export function envelopeOf(row: OutboxClaimRow): Record<string, unknown> {
  return {
    eventId: row.eventId,
    topic: row.type,
    version: 1,
    occurredAt: row.occurredAt,
    // Fase 6: propaga correlação quando a linha a carrega (causa própria ou
    // coluna dedicada conforme o domínio; ausente = consumidor gera/ignora).
    ...(typeof row.correlationId === 'string' && row.correlationId.length > 0
      ? { correlationId: row.correlationId }
      : {}),
    payload: row.payload ?? {},
  };
}

/** jobId BullMQ p/ evento: sempre o eventId (PROJECT.md §5). */
export function relayJobId(eventId: string): string {
  return eventId;
}

export interface OutboxRelayResult {
  claimed: number;
  published: number;
  eventIds: string[];
  /**
   * eventIds que falharam no `queue.add` deste tick (ficam `published = false`
   * p/ o próximo tick). Presente SÓ quando há falha, p/ preservar o shape do
   * caminho de sucesso (consumidores comparam o objeto exato — ex.
   * `billing-transitions.spec.ts`).
   */
  failedEventIds?: string[];
}

export async function relayOutboxBatch(
  db: RelaySqlRunner,
  queue: RelayQueue,
  opts: { table?: string; limit?: number } = {},
): Promise<OutboxRelayResult> {
  const table = opts.table ?? OUTBOX_RELAY_TABLE;
  const limit = opts.limit ?? OUTBOX_RELAY_BATCH;
  const { rows } = await db.query(buildClaimBatchSql(table, limit));
  const claimed = rows.length;
  const eventIds: string[] = [];
  const failedEventIds: string[] = [];
  for (const r of rows) {
    const row = r as unknown as OutboxClaimRow;
    const eventId = String(row.eventId);
    try {
      await queue.add(String(row.type), envelopeOf(row), { jobId: relayJobId(eventId) });
      eventIds.push(eventId);
    } catch {
      // Linha ruim não aborta as linhas/domínios seguintes nem é marcada como
      // publicada: fica p/ o próximo tick (jobId=eventId → dedupe BullMQ).
      failedEventIds.push(eventId);
    }
  }
  if (eventIds.length > 0) {
    await db.query(buildMarkPublishedSql(table), [eventIds]);
  }
  return {
    claimed,
    published: eventIds.length,
    eventIds,
    ...(failedEventIds.length > 0 ? { failedEventIds } : {}),
  };
}
