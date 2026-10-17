// Relay Outbox → BullMQ (Fase 4): resiliência POR LINHA + invariantes do claim.
// Sem PG/Redis: `RelaySqlRunner`/`RelayQueue` são fakes injetados (o tick real
// injeta o Pool do domínio e a Queue BullMQ).
import {
  OUTBOX_RELAY_BATCH,
  OUTBOX_RELAY_TABLE,
  buildMarkPublishedSql,
  relayJobId,
  relayOutboxBatch,
} from './outbox-relay';

type Row = Record<string, unknown>;

function claimRow(eventId: string, over: Row = {}): Row {
  return {
    eventId,
    aggregate: 'payment',
    aggregateId: `agg-${eventId}`,
    type: 'billing.payment.confirmed.v1',
    payload: { eventId },
    occurredAt: '2026-10-10T00:00:00.000Z',
    ...over,
  };
}

/** Fake do Pool PG: SELECT devolve o lote claimado; UPDATE é o mark published. */
function fakeDb(rows: Row[], opts: { claimError?: Error; markError?: Error } = {}) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    queries,
    db: {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.startsWith('SELECT')) {
          if (opts.claimError) throw opts.claimError;
          return { rowCount: rows.length, rows };
        }
        if (opts.markError) throw opts.markError;
        return { rowCount: (params?.[0] as unknown[] | undefined)?.length ?? 0, rows: [] };
      },
    },
  };
}

/** Fake da Queue BullMQ: `failFor` simula jobId/payload problemático ou Redis fora. */
function fakeQueue(opts: { failFor?: (eventId: string) => boolean; error?: Error } = {}) {
  const added: Array<{ type: string; envelope: Row; jobId: string }> = [];
  return {
    added,
    queue: {
      add: async (type: string, envelope: Row, o: { jobId: string }) => {
        if (opts.failFor?.(o.jobId)) throw opts.error ?? new Error('queue.add falhou');
        added.push({ type, envelope, jobId: o.jobId });
        return { id: o.jobId };
      },
    },
  };
}

/** Ids levados ao `UPDATE ... SET published = true WHERE "eventId" = ANY($1)`. */
function markedIds(queries: Array<{ sql: string; params?: unknown[] }>): string[] {
  const mark = queries.find((q) => q.sql.startsWith('UPDATE'));
  return (mark?.params?.[0] as string[] | undefined) ?? [];
}

describe('relayOutboxBatch (resiliência por linha)', () => {
  it('publica tudo com jobId=eventId, envelope atual e marca só publicados', async () => {
    const rows = [claimRow('evt-1'), claimRow('evt-2', { correlationId: 'corr-2' })];
    const { queries, db } = fakeDb(rows);
    const { added, queue } = fakeQueue();

    const out = await relayOutboxBatch(db, queue);

    // Shape do caminho de sucesso INALTERADO (sem `failedEventIds`).
    expect(out).toEqual({ claimed: 2, published: 2, eventIds: ['evt-1', 'evt-2'] });
    expect(added.map((a) => a.jobId)).toEqual(['evt-1', 'evt-2']);
    expect(added[0].jobId).toBe(relayJobId('evt-1'));
    expect(added[0].type).toBe('billing.payment.confirmed.v1');
    expect(added[0].envelope).toEqual({
      eventId: 'evt-1',
      topic: 'billing.payment.confirmed.v1',
      version: 1,
      occurredAt: '2026-10-10T00:00:00.000Z',
      payload: { eventId: 'evt-1' },
    });
    // Fase 6: correlação propagada quando a linha carrega.
    expect(added[1].envelope).toEqual({
      eventId: 'evt-2',
      topic: 'billing.payment.confirmed.v1',
      version: 1,
      occurredAt: '2026-10-10T00:00:00.000Z',
      correlationId: 'corr-2',
      payload: { eventId: 'evt-2' },
    });
    // Claim em lote (FOR UPDATE SKIP LOCKED LIMIT 100) + mark só com publicados.
    expect(queries[0].sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(queries[0].sql).toContain(`LIMIT ${OUTBOX_RELAY_BATCH}`);
    expect(queries[1].sql).toBe(buildMarkPublishedSql(OUTBOX_RELAY_TABLE));
    expect(markedIds(queries)).toEqual(['evt-1', 'evt-2']);
  });

  it('linha que lança no queue.add não aborta o tick nem é marcada (fica p/ o próximo)', async () => {
    const rows = [claimRow('evt-1'), claimRow('evt-2'), claimRow('evt-3')];
    const { queries, db } = fakeDb(rows);
    const { added, queue } = fakeQueue({
      failFor: (id) => id === 'evt-2',
      error: new Error('Custom Id cannot contain :'),
    });

    const out = await relayOutboxBatch(db, queue);

    expect(out.claimed).toBe(3);
    expect(out.published).toBe(2);
    expect(out.eventIds).toEqual(['evt-1', 'evt-3']);
    expect(out.failedEventIds).toEqual(['evt-2']);
    expect(added.map((a) => a.jobId)).toEqual(['evt-1', 'evt-3']); // evt-3 veio depois da falha
    expect(markedIds(queries)).toEqual(['evt-1', 'evt-3']); // evt-2 NÃO marcada
    expect(queries.filter((q) => q.sql.startsWith('UPDATE'))).toHaveLength(1);
  });

  it('todas as linhas falham: tick não lança, nada é marcado e falhas são reportadas', async () => {
    const rows = [claimRow('evt-1'), claimRow('evt-2')];
    const { queries, db } = fakeDb(rows);
    const { added, queue } = fakeQueue({ failFor: () => true });

    const out = await relayOutboxBatch(db, queue);

    expect(out).toEqual({
      claimed: 2,
      published: 0,
      eventIds: [],
      failedEventIds: ['evt-1', 'evt-2'],
    });
    expect(added).toEqual([]);
    expect(queries.filter((q) => q.sql.startsWith('UPDATE'))).toHaveLength(0);
  });

  it('falha no mark published propaga (comportamento atual; replay dedupe no próximo tick)', async () => {
    const { db } = fakeDb([claimRow('evt-1')], { markError: new Error('UPDATE fora') });
    const { added, queue } = fakeQueue();

    await expect(relayOutboxBatch(db, queue)).rejects.toThrow('UPDATE fora');
    expect(added.map((a) => a.jobId)).toEqual(['evt-1']); // enfileirado antes do mark
  });

  it('falha no claim (SELECT) propaga — infra indisponível retenta no próximo tick', async () => {
    const { db } = fakeDb([], { claimError: new Error('PG fora') });
    const { queue } = fakeQueue();

    await expect(relayOutboxBatch(db, queue)).rejects.toThrow('PG fora');
  });

  it('lote vazio: sem mark, zeros e sem lista de falhas', async () => {
    const { queries, db } = fakeDb([]);
    const { queue } = fakeQueue();

    const out = await relayOutboxBatch(db, queue);

    expect(out).toEqual({ claimed: 0, published: 0, eventIds: [] });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql.startsWith('SELECT')).toBe(true);
  });

  it('respeita tabela/limite customizados no claim e no mark', async () => {
    const { queries, db } = fakeDb([claimRow('evt-1')]);
    const { queue } = fakeQueue();

    await relayOutboxBatch(db, queue, { table: 'finance_outbox', limit: 7 });

    expect(queries[0].sql).toContain('FROM finance_outbox');
    expect(queries[0].sql).toContain('LIMIT 7');
    expect(queries[1].sql).toBe(buildMarkPublishedSql('finance_outbox'));
  });
});
