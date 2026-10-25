import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OUTBOX_RELAY_BATCH,
  OUTBOX_RELAY_DOMAINS,
  RelayQueue,
  RelaySqlRunner,
  relayOutboxBatch,
  transactionalRelaySqlRunner,
} from '../../common/outbox/outbox-relay';
import { FINANCE_POOL } from './finance-pool.provider';
import { Pool } from 'pg';

// Relay finance (Fase 5). Drena para BullMQ com `jobId = eventId`; marca
// `published` após enfileirar. Duas tabelas no DB finance (dois workstreams):
// - `outbox_events` (sync billing→finance): FinanceTransactionPosted,
//   ReceivableOverdue, ProjectionRecomputed → audit/reporting/notifications
//   (stubs, TODO Fase 5+).
// - `finance_outbox` (núcleo: baixas): finance.receivable.received.v1,
//   finance.payable.paid.v1 (mesmo contrato: jobId=eventId).
// Fila real (BullMQ) é injetada no boot; sem Redis o tick é no-op registrado.
// Purge 30d: TODO job agendado — ver `buildPurgeSql` + RUNBOOK billing §5.

export const FINANCE_SYNC_OUTBOX_TABLE = 'outbox_events';
export const FINANCE_CORE_OUTBOX_TABLE = 'finance_outbox';

@Injectable()
export class FinanceOutboxRelayService {
  private readonly log = new Logger(FinanceOutboxRelayService.name);
  private readonly db: RelaySqlRunner;

  constructor(@Inject(FINANCE_POOL) private readonly pool: Pool) {
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
      { table: FINANCE_SYNC_OUTBOX_TABLE, limit },
    );
    this.log.log(`outbox relay finance.sync: ${out.published}/${out.claimed} publicados`);
    return out;
  }

  /** Drena a outbox do núcleo (baixas) pelo mesmo contrato. */
  async relayCore(
    queue: RelayQueue,
    limit = OUTBOX_RELAY_BATCH,
  ): Promise<{ claimed: number; published: number; eventIds: string[] }> {
    const out = await relayOutboxBatch(
      this.db,
      queue,
      { table: FINANCE_CORE_OUTBOX_TABLE, limit },
    );
    this.log.log(`outbox relay finance.core: ${out.published}/${out.claimed} publicados`);
    return out;
  }
}
