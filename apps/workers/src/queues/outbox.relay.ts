// Relay Outbox → BullMQ por domínio, lado workers (Fase 4, PROJECT.md §5).
// O SQL canônico vive na API (`apps/api/src/common/outbox/outbox-relay.ts`);
// este módulo duplica SÓ os builders mínimos para o ticker não importar código
// da API (pacotes separados). Divergência intencional: nenhuma — manter os
// dois em sincronia (claim 100 + `jobId = eventId` + purge 30d TODO job).
// I/O (Pool PG por domínio + Queue BullMQ) é injetado: testável sem PG/Redis.

export const OUTBOX_RELAY_BATCH = 100;

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

export function buildClaimBatchSql(table = 'outbox_events', limit = OUTBOX_RELAY_BATCH): string {
  return (
    `SELECT "eventId", aggregate, "aggregateId", type, payload, "occurredAt"` +
    ` FROM ${table} WHERE published = false` +
    ` ORDER BY "occurredAt" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`
  );
}

export function buildMarkPublishedSql(table = 'outbox_events'): string {
  return `UPDATE ${table} SET published = true WHERE "eventId" = ANY($1)`;
}

/** Purge SÓ de publicados com 30d — TODO job agendado (nunca ad-hoc). */
export function buildPurgeSql(table = 'outbox_events'): string {
  return `DELETE FROM ${table} WHERE published = true AND "occurredAt" < now() - interval '30 days'`;
}

export interface RelayClaimRow {
  eventId: string;
  aggregate: string;
  aggregateId: string;
  type: string;
  payload: unknown;
  occurredAt: string;
}

export interface RelayDb {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }>;
}

export interface RelayQueue {
  add(type: string, envelope: Record<string, unknown>, opts: { jobId: string }): Promise<unknown>;
}

export interface RelayDomain {
  domain: string;
  db: RelayDb;
  queue: RelayQueue;
  table?: string;
}

/** Tick do relay: drena cada domínio (claim → publica jobId=eventId → marca). */
export async function runOutboxRelayTick(
  domains: RelayDomain[],
  opts: { limit?: number } = {},
): Promise<{ domains: number; claimed: number; published: number }> {
  const limit = opts.limit ?? OUTBOX_RELAY_BATCH;
  let claimed = 0;
  let published = 0;
  for (const d of domains) {
    const table = d.table ?? 'outbox_events';
    const { rows } = await d.db.query(buildClaimBatchSql(table, limit));
    claimed += rows.length;
    const ids: string[] = [];
    for (const r of rows) {
      const row = r as unknown as RelayClaimRow;
      // jobId = eventId (dedupe BullMQ, PROJECT.md §5).
      await d.queue.add(String(row.type), {
        eventId: row.eventId,
        topic: row.type,
        version: 1,
        occurredAt: row.occurredAt,
        payload: row.payload ?? {},
      }, { jobId: String(row.eventId) });
      ids.push(String(row.eventId));
    }
    if (ids.length > 0) {
      await d.db.query(buildMarkPublishedSql(table), [ids]);
      published += ids.length;
    }
  }
  return { domains: domains.length, claimed, published };
}
