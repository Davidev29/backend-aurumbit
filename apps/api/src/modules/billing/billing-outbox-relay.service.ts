import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OUTBOX_RELAY_BATCH,
  OUTBOX_RELAY_DOMAINS,
  RelayQueue,
  RelaySqlRunner,
  relayOutboxBatch,
  transactionalRelaySqlRunner,
} from '../../common/outbox/outbox-relay';
import { BILLING_POOL } from './billing-pool.provider';
import { Pool } from 'pg';

// Relay billing (Fase 4). Drena `billing.outbox_events` → BullMQ com
// `jobId = eventId`; marca `published` após enfileirar. Outros domínios usam o
// mesmo helper `relayOutboxBatch` com o próprio Pool (ver OUTBOX_RELAY_DOMAINS).
// Fila real (BullMQ) é injetada no boot; sem Redis o tick é no-op registrado.
// Purge 30d: TODO job agendado — ver `buildPurgeSql` + RUNBOOK billing §5.

@Injectable()
export class BillingOutboxRelayService {
  private readonly log = new Logger(BillingOutboxRelayService.name);
  private readonly db: RelaySqlRunner;

  constructor(@Inject(BILLING_POOL) private readonly pool: Pool) {
    this.db = transactionalRelaySqlRunner(pool);
  }

  domains(): readonly string[] {
    return OUTBOX_RELAY_DOMAINS;
  }

  async relay(
    queue: RelayQueue,
    limit = OUTBOX_RELAY_BATCH,
  ): Promise<{ claimed: number; published: number; eventIds: string[] }> {
    const out = await relayOutboxBatch(
      this.db,
      queue,
      { limit },
    );
    this.log.log(`outbox relay billing: ${out.published}/${out.claimed} publicados`);
    return out;
  }
}
