// Consumidor FinanceSyncService — sync billing→finance (Fase 5,
// PROJECT.md §5). NÃO reescreve billing core nem finance core
// (LedgerEntry/PayoutRequest intactos): só consome envelopes do outbox
// billing e escreve as tabelas novas do DB finance.
//
// Efeitos por tipo (sempre na MESMA transação do `finance_processed_events`):
// - PaymentConfirmed → upsert Receivable RECEBIDO + Transaction INCOME.
// - PaymentFailed/Expired → Receivable INADIMPLENTE se vencido.
// - InvoiceOverdue → Receivable INADIMPLENTE + evento.
// - RefundCompleted → Payable PAGO + Transaction EXPENSE (parcial vs total
//   classificado; o flip billing Payment→PARTIALLY_REFUNDED/REFUNDED é
//   TODO do billing core — escrita cross-schema é proibida).
// - SubscriptionActivated/Cancelled → invalida ProjectionSnapshot.
//
// Idempotência: `INSERT processed ... ON CONFLICT(eventId) DO NOTHING`;
// replay (`rowCount 0`) → `{ duplicate: true }` sem reaplicar. Lançamentos
// têm dupla guarda: `UNIQUE(eventId)` + `UNIQUE(provider, externalId)`
// (`ON CONFLICT DO NOTHING` + releitura). Fora de ordem nunca regride
// RECEBIDO/PAGO (ver `sync.transitions.ts`).
//
// Outbox finance (mesmo contrato do relay billing): FinanceTransactionPosted,
// ReceivableOverdue, ProjectionRecomputed → audit/reporting/notifications
// (stubs, TODO Fase 5+).

import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { FINANCE_POOL } from './finance-pool.provider';
import {
  classifyRefund,
  isOverdue,
  normalizeFinanceTopic,
  shouldApplyFinanceEvent,
} from './sync.transitions';

export interface FinanceSqlRunner {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }>;
}

export interface FinanceSqlClient extends FinanceSqlRunner {
  release(): void;
}

export interface FinancePoolLike extends FinanceSqlRunner {
  connect(): Promise<FinanceSqlClient>;
}

export interface FinanceEnvelope {
  eventId: string;
  type?: string;
  topic?: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
  version?: number;
}

export type FinanceSyncResult =
  | { status: 'applied'; eventId: string; type: string; outbox: string[] }
  | { status: 'duplicate'; eventId: string }
  | { status: 'noop'; eventId: string; reason: string };

export interface FinanceSyncMetrics {
  inc(name: 'finance.sync.received' | 'finance.sync.applied' | 'finance.sync.duplicate' | 'finance.sync.noop'): void;
}

/**
 * `id` determinístico do marcador de invalidação por namespace
 * (`global | org:<id>`): mesmo namespace → mesma linha, então o
 * `ON CONFLICT (id)` arbitra na PK e o sync mantém 1 marcador por
 * namespace sem depender do UNIQUE de `scope` (removido em
 * 20261017000000 — o core precisa de 1 snapshot por PERÍODO, logo
 * `scope` deixou de ser único). Mesmo prefixo de chave do store
 * (`snapshotIdOf` usa `scope:refDate:premisesHash`), sem colisão.
 */
export function projectionMarkerIdOf(scope: string): string {
  return createHash('sha256').update(`sync-projection-marker:${scope}`).digest('hex');
}

class NoopFinanceSyncMetrics implements FinanceSyncMetrics {
  inc(): void {
    /* default sem backend */
  }
}

const RECEIVABLE_COLS =
  `id, "customerId", "invoiceId", provider, "externalId", "amountCents", status, version, "occurredAt", "dueDate", "paidAt", "createdAt", "updatedAt"`;
const PAYABLE_COLS =
  `id, "refundId", "paymentExternalId", provider, "externalId", "amountCents", status, version, "occurredAt", "paidAt", "createdAt", "updatedAt"`;
const TRANSACTION_COLS =
  `id, kind, "amountCents", provider, "externalId", "eventId", "receivableId", "payableId", "occurredAt", "createdAt"`;

const CLAIM_PROCESSED_SQL =
  `INSERT INTO finance_processed_events (id, "eventId", type, "occurredAt", "createdAt")` +
  ` VALUES ($1,$2,$3,$4::timestamptz,now())` +
  ` ON CONFLICT ("eventId") DO NOTHING RETURNING id, "eventId"`;

const FIND_RECEIVABLE_SQL =
  `SELECT ${RECEIVABLE_COLS} FROM receivables WHERE provider = $1 AND "externalId" = $2`;

const FIND_PAYABLE_SQL =
  `SELECT ${PAYABLE_COLS} FROM payables WHERE provider = $1 AND "externalId" = $2`;

const FIND_TRANSACTION_SQL =
  `SELECT ${TRANSACTION_COLS} FROM finance_transactions WHERE "eventId" = $1 OR (provider = $2 AND "externalId" = $3)`;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

@Injectable()
export class FinanceSyncService {
  private readonly logger = new Logger(FinanceSyncService.name);
  private metrics: FinanceSyncMetrics = new NoopFinanceSyncMetrics();

  constructor(@Inject(FINANCE_POOL) private readonly pool: FinancePoolLike) {}

  withMetrics(metrics: FinanceSyncMetrics): this {
    this.metrics = metrics;
    return this;
  }

  /** Entrada do consumidor (controller interno + worker). Roteia por tipo normalizado. */
  async handleEnvelope(envelope: FinanceEnvelope): Promise<FinanceSyncResult> {
    const eventId = str(envelope?.eventId) ?? '';
    if (!eventId) throw new Error('eventId obrigatório');
    const type = normalizeFinanceTopic(
      str(envelope.type) ?? str(envelope.topic) ?? '',
    );
    this.metrics.inc('finance.sync.received');
    if (!type) {
      this.metrics.inc('finance.sync.noop');
      return { status: 'noop', eventId, reason: 'tipo-desconhecido' };
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query(CLAIM_PROCESSED_SQL, [
        randomUUID(),
        eventId,
        type,
        envelope.occurredAt ?? envelope.payload?.occurredAt ?? null,
      ]);
      if ((claimed.rowCount ?? claimed.rows.length) === 0 || claimed.rows.length === 0) {
        await client.query('ROLLBACK');
        this.metrics.inc('finance.sync.duplicate');
        return { status: 'duplicate', eventId };
      }
      const outbox: string[] = [];
      switch (type) {
        case 'PaymentConfirmed':
          await this.applyPaymentConfirmed(client, eventId, envelope, outbox);
          break;
        case 'PaymentFailed':
        case 'PaymentExpired':
          await this.applyPaymentFailed(client, eventId, envelope, type, outbox);
          break;
        case 'InvoiceOverdue':
          await this.applyInvoiceOverdue(client, eventId, envelope, outbox);
          break;
        case 'RefundCompleted':
          await this.applyRefundCompleted(client, eventId, envelope, outbox);
          break;
        case 'SubscriptionActivated':
        case 'SubscriptionCancelled':
          await this.applySubscriptionProjection(client, eventId, envelope, type, outbox);
          break;
      }
      await client.query('COMMIT');
      if (outbox.length === 0) {
        this.metrics.inc('finance.sync.noop');
        return { status: 'noop', eventId, reason: 'sem-efeito' };
      }
      this.metrics.inc('finance.sync.applied');
      return { status: 'applied', eventId, type, outbox };
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  // -- PaymentConfirmed → Receivable RECEBIDO + Transaction INCOME ----------

  private async applyPaymentConfirmed(
    client: FinanceSqlRunner,
    eventId: string,
    envelope: FinanceEnvelope,
    outbox: string[],
  ): Promise<void> {
    const p = envelope.payload ?? {};
    const provider = str(p.provider) ?? 'ASAAS';
    const externalId = str(p.externalId) ?? str(p.paymentExternalId);
    const amountCents = num(p.amountCents);
    if (!externalId || amountCents == null) {
      this.logger.warn(
        JSON.stringify({ event: 'finance.sync.sem-identidade', eventId, at: new Date().toISOString() }),
      );
      return;
    }
    const occurred = str(p.occurredAt) ?? str(p.paidAt) ?? envelope.occurredAt ?? null;
    const version = num(p.version) ?? envelope.version ?? null;
    const { rows } = await client.query(FIND_RECEIVABLE_SQL, [provider, externalId]);
    const existing = rows[0] as Record<string, unknown> | undefined;
    let receivableId: string;
    if (!existing) {
      const ins = await client.query(
        `INSERT INTO receivables (id, "customerId", "invoiceId", provider, "externalId", "amountCents",` +
          ` status, version, "occurredAt", "dueDate", "paidAt", "createdAt", "updatedAt")` +
          ` VALUES ($1,$2,$3,$4,$5,$6,'RECEBIDO',$7,$8::timestamptz,$9::timestamptz,$10::timestamptz,now(),now())` +
          ` RETURNING ${RECEIVABLE_COLS}`,
        [
          randomUUID(), str(p.customerId) ?? null, str(p.invoiceId) ?? null,
          provider, externalId, amountCents, version ?? 1, occurred,
          str(p.dueDate) ?? null, str(p.paidAt) ?? occurred,
        ],
      );
      receivableId = String(ins.rows[0].id);
    } else {
      const gate = shouldApplyFinanceEvent({
        currentStatus: String(existing.status),
        currentOccurredAt: (existing.occurredAt as string | null) ?? null,
        currentVersion: num(existing.version),
        incomingOccurredAt: occurred,
        incomingVersion: version,
      });
      if (!gate.apply) {
        this.logger.warn(
          JSON.stringify({ event: 'finance.sync.stale-ignored', eventId, reason: gate.reason, at: new Date().toISOString() }),
        );
        return;
      }
      const upd = await client.query(
        `UPDATE receivables SET status = 'RECEBIDO', "amountCents" = $2, version = $3,` +
          ` "occurredAt" = COALESCE($4::timestamptz, "occurredAt"),` +
          ` "paidAt" = COALESCE($5::timestamptz, "paidAt"), "updatedAt" = now()` +
          ` WHERE id = $1 RETURNING ${RECEIVABLE_COLS}`,
        [String(existing.id), amountCents, version ?? (num(existing.version) ?? 0) + 1, occurred, str(p.paidAt) ?? occurred],
      );
      receivableId = String(upd.rows[0].id);
    }
    // Lançamento INCOME — dupla guarda: ON CONFLICT DO NOTHING cobre
    // UNIQUE(eventId) e UNIQUE(provider, externalId) (replay ou segunda
    // via do mesmo pagamento nunca duplica saldo).
    const txn = await client.query(
      `INSERT INTO finance_transactions (id, kind, "amountCents", provider, "externalId", "eventId",` +
        ` "receivableId", "payableId", "occurredAt", "createdAt")` +
        ` VALUES ($1,'INCOME',$2,$3,$4,$5,$6,NULL,$7::timestamptz,now())` +
        ` ON CONFLICT DO NOTHING RETURNING id`,
      [randomUUID(), amountCents, provider, externalId, eventId, receivableId, occurred],
    );
    if (txn.rows.length === 0) {
      const { rows: dup } = await client.query(FIND_TRANSACTION_SQL, [eventId, provider, externalId]);
      this.logger.warn(
        JSON.stringify({
          event: 'finance.sync.transaction-duplicate', eventId,
          transactionId: dup[0] ? String((dup[0] as Record<string, unknown>).id) : null,
          at: new Date().toISOString(),
        }),
      );
      return; // sem outbox nova: efeito econômico já lançado
    }
    await this.emitOutbox(client, 'Receivable', receivableId, 'FinanceTransactionPosted', {
      eventId,
      kind: 'INCOME',
      provider,
      externalId,
      amountCents,
      receivableId,
      transactionId: String(txn.rows[0].id),
    });
    outbox.push('FinanceTransactionPosted');
  }

  // -- PaymentFailed/Expired → INADIMPLENTE se vencido ---------------------

  private async applyPaymentFailed(
    client: FinanceSqlRunner,
    eventId: string,
    envelope: FinanceEnvelope,
    type: 'PaymentFailed' | 'PaymentExpired',
    outbox: string[],
  ): Promise<void> {
    const p = envelope.payload ?? {};
    const provider = str(p.provider) ?? 'ASAAS';
    const externalId = str(p.externalId) ?? str(p.paymentExternalId);
    if (!externalId) {
      this.logger.warn(JSON.stringify({ event: 'finance.sync.sem-identidade', eventId, at: new Date().toISOString() }));
      return;
    }
    const occurred = str(p.occurredAt) ?? envelope.occurredAt ?? null;
    const version = num(p.version) ?? envelope.version ?? null;
    const { rows } = await client.query(FIND_RECEIVABLE_SQL, [provider, externalId]);
    const existing = rows[0] as Record<string, unknown> | undefined;
    const amountCents = num(p.amountCents);
    if (!existing && amountCents == null) return; // sem valor: nada a espelhar
    const dueDate = str(p.dueDate) ?? (existing ? (existing.dueDate as string | null) : null);
    const overdue = isOverdue(dueDate);
    let receivableId: string;
    if (!existing) {
      const ins = await client.query(
        `INSERT INTO receivables (id, "customerId", "invoiceId", provider, "externalId", "amountCents",` +
          ` status, version, "occurredAt", "dueDate", "paidAt", "createdAt", "updatedAt")` +
          ` VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,NULL,now(),now())` +
          ` RETURNING ${RECEIVABLE_COLS}`,
        [
          randomUUID(), str(p.customerId) ?? null, str(p.invoiceId) ?? null,
          provider, externalId, amountCents ?? 0,
          overdue ? 'INADIMPLENTE' : 'PENDENTE', version ?? 1, occurred, dueDate,
        ],
      );
      receivableId = String(ins.rows[0].id);
    } else {
      const gate = shouldApplyFinanceEvent({
        currentStatus: String(existing.status),
        currentOccurredAt: (existing.occurredAt as string | null) ?? null,
        currentVersion: num(existing.version),
        incomingOccurredAt: occurred,
        incomingVersion: version,
      });
      if (!gate.apply) {
        this.logger.warn(
          JSON.stringify({ event: 'finance.sync.stale-ignored', eventId, reason: gate.reason, at: new Date().toISOString() }),
        );
        return; // terminal RECEBIDO nunca regride p/ falha
      }
      const next = overdue ? 'INADIMPLENTE' : String(existing.status ?? 'PENDENTE');
      const upd = await client.query(
        `UPDATE receivables SET status = $2, version = $3,` +
          ` "occurredAt" = COALESCE($4::timestamptz, "occurredAt"),` +
          ` "dueDate" = COALESCE($5::timestamptz, "dueDate"), "updatedAt" = now()` +
          ` WHERE id = $1 RETURNING ${RECEIVABLE_COLS}`,
        [String(existing.id), next, version ?? (num(existing.version) ?? 0) + 1, occurred, dueDate],
      );
      receivableId = String(upd.rows[0].id);
      if (next !== 'INADIMPLENTE') return; // ainda não vencido: sem evento
    }
    if (!overdue) return;
    void type;
    await this.emitOutbox(client, 'Receivable', receivableId, 'ReceivableOverdue', {
      eventId,
      provider,
      externalId,
      amountCents: amountCents ?? (existing ? num(existing.amountCents) : null),
      dueDate,
    });
    outbox.push('ReceivableOverdue');
  }

  // -- InvoiceOverdue → INADIMPLENTE + evento --------------------------------

  private async applyInvoiceOverdue(
    client: FinanceSqlRunner,
    eventId: string,
    envelope: FinanceEnvelope,
    outbox: string[],
  ): Promise<void> {
    const p = envelope.payload ?? {};
    const invoiceId = str(p.invoiceId);
    const provider = str(p.provider) ?? 'ASAAS';
    const externalId = str(p.asaasInvoiceId) ?? (invoiceId ? `invoice:${invoiceId}` : null);
    if (!externalId) {
      this.logger.warn(JSON.stringify({ event: 'finance.sync.sem-identidade', eventId, at: new Date().toISOString() }));
      return;
    }
    const occurred = str(p.occurredAt) ?? envelope.occurredAt ?? null;
    const version = num(p.version) ?? envelope.version ?? null;
    const { rows } = await client.query(FIND_RECEIVABLE_SQL, [provider, externalId]);
    const existing = rows[0] as Record<string, unknown> | undefined;
    let receivableId: string;
    let amountCents = num(p.amountCents);
    if (!existing) {
      if (amountCents == null) return;
      const ins = await client.query(
        `INSERT INTO receivables (id, "customerId", "invoiceId", provider, "externalId", "amountCents",` +
          ` status, version, "occurredAt", "dueDate", "paidAt", "createdAt", "updatedAt")` +
          ` VALUES ($1,$2,$3,$4,$5,$6,'INADIMPLENTE',$7,$8::timestamptz,$9::timestamptz,NULL,now(),now())` +
          ` RETURNING ${RECEIVABLE_COLS}`,
        [
          randomUUID(), str(p.customerId) ?? null, invoiceId,
          provider, externalId, amountCents, version ?? 1, occurred, str(p.dueDate) ?? null,
        ],
      );
      receivableId = String(ins.rows[0].id);
    } else {
      amountCents = amountCents ?? num(existing.amountCents);
      const gate = shouldApplyFinanceEvent({
        currentStatus: String(existing.status),
        currentOccurredAt: (existing.occurredAt as string | null) ?? null,
        currentVersion: num(existing.version),
        incomingOccurredAt: occurred,
        incomingVersion: version,
      });
      if (!gate.apply) {
        this.logger.warn(
          JSON.stringify({ event: 'finance.sync.stale-ignored', eventId, reason: gate.reason, at: new Date().toISOString() }),
        );
        return; // já RECEBIDO: inadimplência antiga não regride
      }
      const upd = await client.query(
        `UPDATE receivables SET status = 'INADIMPLENTE', version = $2,` +
          ` "occurredAt" = COALESCE($3::timestamptz, "occurredAt"),` +
          ` "dueDate" = COALESCE($4::timestamptz, "dueDate"), "updatedAt" = now()` +
          ` WHERE id = $1 RETURNING ${RECEIVABLE_COLS}`,
        [String(existing.id), version ?? (num(existing.version) ?? 0) + 1, occurred, str(p.dueDate) ?? null],
      );
      receivableId = String(upd.rows[0].id);
    }
    await this.emitOutbox(client, 'Receivable', receivableId, 'ReceivableOverdue', {
      eventId,
      provider,
      externalId,
      invoiceId,
      amountCents,
      dueDate: str(p.dueDate) ?? null,
    });
    outbox.push('ReceivableOverdue');
  }

  // -- RefundCompleted → Payable PAGO + Transaction EXPENSE ------------------
  //
  // TODO(billing-hook): o pagamento billing deveria flipar para
  // PARTIALLY_REFUNDED (parcial) ou REFUNDED (total). Escrita cross-schema é
  // proibida (1 banco por domínio, PROJECT.md): o billing core observa
  // `RefundCompleted` pelo próprio pipeline e aplica a transição lá. Aqui
  // só classificamos e carregamos `refundClassification` no outbox.

  private async applyRefundCompleted(
    client: FinanceSqlRunner,
    eventId: string,
    envelope: FinanceEnvelope,
    outbox: string[],
  ): Promise<void> {
    const p = envelope.payload ?? {};
    const provider = str(p.provider) ?? 'ASAAS';
    const externalId = str(p.externalId) ?? (str(p.refundId) ? `refund:${p.refundId}` : null);
    const amountCents = num(p.amountCents);
    if (!externalId || amountCents == null) {
      this.logger.warn(JSON.stringify({ event: 'finance.sync.sem-identidade', eventId, at: new Date().toISOString() }));
      return;
    }
    const occurred = str(p.occurredAt) ?? str(p.completedAt) ?? envelope.occurredAt ?? null;
    const version = num(p.version) ?? envelope.version ?? null;
    const { rows } = await client.query(FIND_PAYABLE_SQL, [provider, externalId]);
    const existing = rows[0] as Record<string, unknown> | undefined;
    let payableId: string;
    if (!existing) {
      const ins = await client.query(
        `INSERT INTO payables (id, "refundId", "paymentExternalId", provider, "externalId", "amountCents",` +
          ` status, version, "occurredAt", "paidAt", "createdAt", "updatedAt")` +
          ` VALUES ($1,$2,$3,$4,$5,$6,'PAGO',$7,$8::timestamptz,$9::timestamptz,now(),now())` +
          ` RETURNING ${PAYABLE_COLS}`,
        [
          randomUUID(), str(p.refundId) ?? null, str(p.paymentExternalId) ?? str(p.paymentId) ?? null,
          provider, externalId, amountCents, version ?? 1, occurred, occurred,
        ],
      );
      payableId = String(ins.rows[0].id);
    } else {
      const gate = shouldApplyFinanceEvent({
        currentStatus: String(existing.status),
        currentOccurredAt: (existing.occurredAt as string | null) ?? null,
        currentVersion: num(existing.version),
        incomingOccurredAt: occurred,
        incomingVersion: version,
      });
      if (!gate.apply) {
        this.logger.warn(
          JSON.stringify({ event: 'finance.sync.stale-ignored', eventId, reason: gate.reason, at: new Date().toISOString() }),
        );
        return;
      }
      const upd = await client.query(
        `UPDATE payables SET status = 'PAGO', "amountCents" = $2, version = $3,` +
          ` "occurredAt" = COALESCE($4::timestamptz, "occurredAt"),` +
          ` "paidAt" = COALESCE($4::timestamptz, "paidAt"), "updatedAt" = now()` +
          ` WHERE id = $1 RETURNING ${PAYABLE_COLS}`,
        [String(existing.id), amountCents, version ?? (num(existing.version) ?? 0) + 1, occurred],
      );
      payableId = String(upd.rows[0].id);
    }
    const txn = await client.query(
      `INSERT INTO finance_transactions (id, kind, "amountCents", provider, "externalId", "eventId",` +
        ` "receivableId", "payableId", "occurredAt", "createdAt")` +
        ` VALUES ($1,'EXPENSE',$2,$3,$4,$5,NULL,$6,$7::timestamptz,now())` +
        ` ON CONFLICT DO NOTHING RETURNING id`,
      [randomUUID(), amountCents, provider, externalId, eventId, payableId, occurred],
    );
    if (txn.rows.length === 0) {
      const { rows: dup } = await client.query(FIND_TRANSACTION_SQL, [eventId, provider, externalId]);
      this.logger.warn(
        JSON.stringify({
          event: 'finance.sync.transaction-duplicate', eventId,
          transactionId: dup[0] ? String((dup[0] as Record<string, unknown>).id) : null,
          at: new Date().toISOString(),
        }),
      );
      return;
    }
    const refundClassification = classifyRefund({
      refundAmountCents: amountCents,
      paymentAmountCents: num(p.paymentAmountCents),
      refundedTotalCents: num(p.refundedTotalCents),
    });
    await this.emitOutbox(client, 'Payable', payableId, 'FinanceTransactionPosted', {
      eventId,
      kind: 'EXPENSE',
      provider,
      externalId,
      amountCents,
      payableId,
      transactionId: String(txn.rows[0].id),
      refundClassification,
      // Stub p/ o billing-hook (TODO acima): o billing core flipa o Payment.
      billingTodo: `Payment→${refundClassification}`,
    });
    outbox.push('FinanceTransactionPosted');
  }

  // -- SubscriptionActivated/Cancelled → invalida projeção -------------------

  private async applySubscriptionProjection(
    client: FinanceSqlRunner,
    eventId: string,
    envelope: FinanceEnvelope,
    type: 'SubscriptionActivated' | 'SubscriptionCancelled',
    outbox: string[],
  ): Promise<void> {
    const p = envelope.payload ?? {};
    const scope = str(p.orgId) ? `org:${p.orgId}` : 'global';
    const { rows } = await client.query(
      `SELECT id, scope, valid, "computedAt", "invalidatedAt" FROM projection_snapshots WHERE scope = $1`,
      [scope],
    );
    const existing = rows[0] as Record<string, unknown> | undefined;
    let snapshotId: string;
    if (!existing) {
      // 1 marcador por namespace, arbitrado pela PK `id` (id determinístico):
      // o UNIQUE de `scope` saiu em 20261017000000 p/ o core guardar 1
      // snapshot por período. `ref_date`/`premises_hash` seguem NULL —
      // marcador não tem período — então o UNIQUE composto não colide.
      const ins = await client.query(
        `INSERT INTO projection_snapshots (id, scope, valid, "computedAt", "invalidatedAt", "createdAt", "updatedAt")` +
          ` VALUES ($1,$2,false,NULL,now(),now(),now())` +
          ` ON CONFLICT (id) DO UPDATE SET valid = false, "invalidatedAt" = now(), "updatedAt" = now()` +
          ` RETURNING id`,
        [projectionMarkerIdOf(scope), scope],
      );
      snapshotId = String(ins.rows[0].id);
    } else {
      if (existing.valid === false) return; // já invalidado: sem novo evento
      const upd = await client.query(
        `UPDATE projection_snapshots SET valid = false, "invalidatedAt" = now(), "updatedAt" = now()` +
          ` WHERE id = $1 RETURNING id`,
        [String(existing.id)],
      );
      snapshotId = String(upd.rows[0].id);
    }
    // Stub: o recálculo real é do reporting (TODO Fase 5+); aqui só o
    // marco de invalidação p/ audit/reporting/notifications.
    await this.emitOutbox(client, 'Projection', snapshotId, 'ProjectionRecomputed', {
      eventId,
      scope,
      trigger: type,
      subscriptionId: str(p.subscriptionId) ?? null,
      invalidated: true,
      recompute: 'stub-reporting-TODO',
    });
    outbox.push('ProjectionRecomputed');
  }

  // -- outbox -----------------------------------------------------------------

  private async emitOutbox(
    client: FinanceSqlRunner,
    aggregate: string,
    aggregateId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // eventId determinístico por efeito: re-emissão do mesmo efeito
    // colide em UNIQUE(eventId) → sem duplicar (cinto + suspensório com o
    // ProcessedEvent, que já barra o replay antes).
    const outEventId = `finance:${type}:${String(payload.eventId ?? aggregateId)}`;
    await client.query(
      `INSERT INTO outbox_events (id, "eventId", aggregate, "aggregateId", type, payload, "occurredAt", published, "createdAt")` +
        ` VALUES ($1,$2,$3,$4,$5,$6::jsonb,now(),false,now())` +
        ` ON CONFLICT ("eventId") DO NOTHING`,
      [randomUUID(), outEventId, aggregate, aggregateId, type, JSON.stringify(payload)],
    );
  }
}
