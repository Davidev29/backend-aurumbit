// Relay Outbox → BullMQ por domínio, lado workers (Fase 4, PROJECT.md §5).
// O SQL canônico vive na API (`apps/api/src/common/outbox/outbox-relay.ts`);
// este módulo duplica SÓ os builders mínimos para o ticker não importar código
// da API (pacotes separados). Divergência intencional: nenhuma — manter os
// dois em sincronia (claim 100 + `jobId = eventId` + purge 30d TODO job +
// resiliência POR LINHA: `queue.add` que lança fica `published = false`, NÃO
// aborta linhas/domínios seguintes e sai em `failedEventIds`).
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
  /** Opcional: suporte a transação para claim+mark atômicos. */
  begin?(): Promise<void>;
  commit?(): Promise<void>;
  rollback?(): Promise<void>;
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

export interface OutboxRelayTickResult {
  domains: number;
  claimed: number;
  published: number;
  /**
   * eventIds que falharam no `queue.add` deste tick (ficam `published = false`
   * p/ o próximo tick). Presente SÓ quando há falha, p/ preservar o shape do
   * caminho de sucesso (mesmo contrato do lado API).
   */
  failedEventIds?: string[];
}

/** Tick do relay: drena cada domínio (claim → publica jobId=eventId → marca). */
export async function runOutboxRelayTick(
  domains: RelayDomain[],
  opts: { limit?: number } = {},
): Promise<OutboxRelayTickResult> {
  const limit = opts.limit ?? OUTBOX_RELAY_BATCH;
  let claimed = 0;
  let published = 0;
  const failedEventIds: string[] = [];
  for (const d of domains) {
    const table = d.table ?? 'outbox_events';
    const tx = typeof d.db.begin === 'function' && typeof d.db.commit === 'function' && typeof d.db.rollback === 'function';
    if (tx) await (d.db as any).begin();
    try {
      const { rows } = await d.db.query(buildClaimBatchSql(table, limit));
      claimed += rows.length;
      const ids: string[] = [];
      for (const r of rows) {
        const row = r as unknown as RelayClaimRow;
        const eventId = String(row.eventId);
        try {
          // jobId = eventId (dedupe BullMQ, PROJECT.md §5).
          await d.queue.add(
            String(row.type),
            {
              eventId: row.eventId,
              topic: row.type,
              version: 1,
              occurredAt: row.occurredAt,
              payload: row.payload ?? {},
            },
            { jobId: eventId },
          );
          ids.push(eventId);
        } catch {
          // Linha ruim não aborta as linhas/domínios seguintes nem é marcada como
          // publicada: fica p/ o próximo tick (jobId=eventId → dedupe BullMQ).
          failedEventIds.push(eventId);
        }
      }
      if (ids.length > 0) {
        await d.db.query(buildMarkPublishedSql(table), [ids]);
        published += ids.length;
      }
      if (tx) await (d.db as any).commit();
    } catch (err) {
      if (tx) {
        try { await (d.db as any).rollback(); } catch { /* noop */ }
      }
      throw err;
    }
  }
  return {
    domains: domains.length,
    claimed,
    published,
    ...(failedEventIds.length > 0 ? { failedEventIds } : {}),
  };
}
