import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OUTBOX_RELAY_BATCH,
  OUTBOX_RELAY_DOMAINS,
  RelayQueue,
  RelaySqlRunner,
  relayOutboxBatch,
} from '../../common/outbox/outbox-relay';
import { BILLING_POOL } from './billing-pool.provider';

// Relay billing (Fase 4). Drena `billing.outbox_events` → BullMQ com
// `jobId = eventId`; marca `published` após enfileirar. Outros domínios usam o
// mesmo helper `relayOutboxBatch` com o próprio Pool (ver OUTBOX_RELAY_DOMAINS).
// Fila real (BullMQ) é injetada no boot; sem Redis o tick é no-op registrado.
// Purge 30d: TODO job agendado — ver `buildPurgeSql` + RUNBOOK billing §5.

@Injectable()
export class BillingOutboxRelayService {
  private readonly log = new Logger(BillingOutboxRelayService.name);

  constructor(@Inject(BILLING_POOL) private readonly pool: { query: RelaySqlRunner['query'] }) {}

  domains(): readonly string[] {
    return OUTBOX_RELAY_DOMAINS;
  }

  async relay(
    queue: RelayQueue,
    limit = OUTBOX_RELAY_BATCH,
  ): Promise<{ claimed: number; published: number; eventIds: string[] }> {
    const out = await relayOutboxBatch(
      this.pool as unknown as RelaySqlRunner,
      queue,
      { limit },
    );
    this.log.log(`outbox relay billing: ${out.published}/${out.claimed} publicados`);
    return out;
  }
}
