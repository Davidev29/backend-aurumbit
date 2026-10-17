// Relay Outbox → BullMQ lado workers: resiliência POR LINHA + continuidade entre
// domínios. node:test + ts-node (mesma convenção de `licensing.issue.spec.ts`).
// Rodar: `pnpm --filter @aurum-bit/workers exec ts-node --transpile-only src/queues/outbox.relay.spec.ts`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runOutboxRelayTick, type RelayDomain } from './outbox.relay';

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

/** Fake de um domínio: Pool PG + Queue BullMQ injetados (sem PG/Redis real). */
function fakeDomain(
  domain: string,
  rows: Row[],
  opts: {
    failAddFor?: (eventId: string) => boolean;
    addError?: Error;
    claimError?: Error;
    markError?: Error;
    table?: string;
  } = {},
): {
  added: Array<{ type: string; envelope: Row; jobId: string }>;
  queries: Array<{ sql: string; params?: unknown[] }>;
  relay: RelayDomain;
} {
  const added: Array<{ type: string; envelope: Row; jobId: string }> = [];
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const relay: RelayDomain = {
    domain,
    table: opts.table,
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
    queue: {
      add: async (type: string, envelope: Row, o: { jobId: string }) => {
        if (opts.failAddFor?.(o.jobId)) throw opts.addError ?? new Error('queue.add falhou');
        added.push({ type, envelope, jobId: o.jobId });
        return { id: o.jobId };
      },
    },
  };
  return { added, queries, relay };
}

/** Ids levados ao `UPDATE ... SET published = true WHERE "eventId" = ANY($1)`. */
function markedIds(queries: Array<{ sql: string; params?: unknown[] }>): string[] {
  const marks = queries.filter((q) => q.sql.startsWith('UPDATE'));
  return marks.flatMap((q) => (q.params?.[0] as string[] | undefined) ?? []);
}

describe('runOutboxRelayTick (resiliência por linha)', () => {
  it('drena o domínio com jobId=eventId, envelope atual e marca só publicados', async () => {
    const { added, queries, relay } = fakeDomain('billing', [claimRow('evt-1'), claimRow('evt-2')]);

    const out = await runOutboxRelayTick([relay]);

    // Shape do caminho de sucesso INALTERADO (sem `failedEventIds`).
    assert.deepEqual(out, { domains: 1, claimed: 2, published: 2 });
    assert.deepEqual(
      added.map((a) => a.jobId),
      ['evt-1', 'evt-2'],
    );
    assert.equal(added[0].type, 'billing.payment.confirmed.v1');
    assert.deepEqual(added[0].envelope, {
      eventId: 'evt-1',
      topic: 'billing.payment.confirmed.v1',
      version: 1,
      occurredAt: '2026-10-10T00:00:00.000Z',
      payload: { eventId: 'evt-1' },
    });
    assert.match(queries[0].sql, /FOR UPDATE SKIP LOCKED/);
    assert.deepEqual(markedIds(queries), ['evt-1', 'evt-2']);
  });

  it('linha que lança no queue.add não aborta o domínio nem é marcada (fica p/ o próximo tick)', async () => {
    const { added, queries, relay } = fakeDomain(
      'billing',
      [claimRow('evt-1'), claimRow('evt-2'), claimRow('evt-3')],
      { failAddFor: (id) => id === 'evt-2', addError: new Error('Custom Id cannot contain :') },
    );

    const out = await runOutboxRelayTick([relay]);

    assert.deepEqual(out, {
      domains: 1,
      claimed: 3,
      published: 2,
      failedEventIds: ['evt-2'],
    });
    assert.deepEqual(
      added.map((a) => a.jobId),
      ['evt-1', 'evt-3'],
    ); // evt-3 veio depois da falha
    assert.deepEqual(markedIds(queries), ['evt-1', 'evt-3']); // evt-2 NÃO marcada
    assert.equal(queries.filter((q) => q.sql.startsWith('UPDATE')).length, 1);
  });

  it('falha em um domínio não impede o processamento do domínio seguinte', async () => {
    const d1 = fakeDomain('billing', [claimRow('evt-bad'), claimRow('evt-ok')], {
      failAddFor: (id) => id === 'evt-bad',
    });
    const d2 = fakeDomain('finance', [claimRow('evt-fin')]);

    const out = await runOutboxRelayTick([d1.relay, d2.relay]);

    assert.deepEqual(out, {
      domains: 2,
      claimed: 3,
      published: 2,
      failedEventIds: ['evt-bad'],
    });
    // Domínio 1 publicou o que pôde...
    assert.deepEqual(
      d1.added.map((a) => a.jobId),
      ['evt-ok'],
    );
    assert.deepEqual(markedIds(d1.queries), ['evt-ok']);
    // ...e o domínio seguinte drenou inteiro.
    assert.deepEqual(
      d2.added.map((a) => a.jobId),
      ['evt-fin'],
    );
    assert.deepEqual(markedIds(d2.queries), ['evt-fin']);
  });

  it('falha no mark published propaga (comportamento atual; replay dedupe no próximo tick)', async () => {
    const { added, relay } = fakeDomain('billing', [claimRow('evt-1')], {
      markError: new Error('UPDATE fora'),
    });

    await assert.rejects(() => runOutboxRelayTick([relay]), /UPDATE fora/);
    assert.deepEqual(
      added.map((a) => a.jobId),
      ['evt-1'],
    ); // enfileirado antes do mark
  });

  it('falha no claim (SELECT) propaga — infra indisponível retenta no próximo tick', async () => {
    const { relay } = fakeDomain('billing', [], { claimError: new Error('PG fora') });

    await assert.rejects(() => runOutboxRelayTick([relay]), /PG fora/);
  });

  it('sem domínios/linhas: zeros, sem mark e sem lista de falhas', async () => {
    const empty = fakeDomain('audit', []);

    const out = await runOutboxRelayTick([empty.relay]);

    assert.deepEqual(out, { domains: 1, claimed: 0, published: 0 });
    assert.equal(empty.queries.filter((q) => q.sql.startsWith('UPDATE')).length, 0);
    assert.deepEqual(empty.added, []);
  });

  it('respeita tabela/limite customizados por domínio', async () => {
    const { queries, relay } = fakeDomain('billing', [claimRow('evt-1')], {
      table: 'billing_outbox',
    });

    await runOutboxRelayTick([relay], { limit: 7 });

    assert.match(queries[0].sql, /FROM billing_outbox/);
    assert.match(queries[0].sql, /LIMIT 7/);
    assert.match(queries[1].sql, /UPDATE billing_outbox/);
  });
});
