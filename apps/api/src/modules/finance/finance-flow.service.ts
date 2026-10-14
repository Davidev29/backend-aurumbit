import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { FinanceMetrics } from './finance-metrics';

// Fluxo financeiro canônico (Fase 5, PROJECT.md §3 + REQUIREMENTS §3).
// In-memory + hermético (e2e sem PG/Redis); adaptador PG sobre `finance.*`
// segue o mesmo contrato (UNIQUE(eventId), Transaction único mutador).
//
// NÃO reescreve billing/*: este serviço é o dono do lado financeiro do
// `PaymentConfirmed` (fan-out billing → finance) + baixas manuais + projeções.
// - Previsto/pendente/realizado: Receivable/Payable nascem PREVISTO/PENDENTE;
//   viram RECEBIDO/PAGO só via baixa (webhook ou manual).
// - Transaction é o ÚNICO mutador de saldo: baixas sempre criam exatamente
//   1 Transaction (INCOME/EXPENSE) idempotente por eventId.
// - Replay do mesmo eventId → duplicate, sem duplicar Receivable/Transaction.
// - ProjectionSnapshot carrega `premisesHash` (SHA256 das premissas); ticker
//   do worker invalida snapshots expirados (ver `finance.projection.ts`).
// - Auditoria sem PII: `finance.transaction.posted` + `finance.read.grant`
//   com ator/org/motivo/valores operacionais (LGPD.md — sem nome/e-mail/doc).

export type ReceivableStatus = 'PREVISTO' | 'PENDENTE' | 'RECEBIDO' | 'CANCELADO';
export type PayableStatus = 'PREVISTO' | 'PENDENTE' | 'PAGO' | 'CANCELADO';

export interface ReceivableRecord {
  id: string;
  orgId: string;
  externalId: string | null;
  amountCents: number;
  status: ReceivableStatus;
  dueDate: string | null;
  paidAt: string | null;
  eventId: string | null;
  createdAt: string;
}

export interface PayableRecord {
  id: string;
  orgId: string;
  amountCents: number;
  status: PayableStatus;
  dueDate: string | null;
  paidAt: string | null;
  eventId: string | null;
  createdAt: string;
}

export interface TransactionRecord {
  id: string;
  orgId: string;
  kind: 'INCOME' | 'EXPENSE';
  amountCents: number;
  refKind: 'receivable' | 'payable';
  refId: string;
  eventId: string;
  createdAt: string;
}

export interface ProjectionSnapshot {
  id: string;
  orgId: string;
  horizonDays: number;
  premisesHash: string;
  realizedCents: number;
  pendingCents: number;
  forecastCents: number;
  computedAt: string;
  expiresAt: string;
}

export interface FinanceGrant {
  id: string;
  orgId: string;
  grantee: string;
  reason: string;
  actorId: string;
  createdAt: string;
}

export const PROJECTION_TTL_MS = 15 * 60 * 1000;

export function projectionKey(orgId: string, horizonDays: number): string {
  return `${orgId}:${horizonDays}`;
}

/** Hash canônico das premissas (org + horizonte + realizado + pendente). */
export function premisesHashFor(input: {
  orgId: string;
  horizonDays: number;
  realizedCents: number;
  pendingCents: number;
  forecastCents: number;
}): string {
  const canonical = JSON.stringify({
    forecastCents: input.forecastCents,
    horizonDays: input.horizonDays,
    orgId: input.orgId,
    pendingCents: input.pendingCents,
    realizedCents: input.realizedCents,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

@Injectable()
export class FinanceFlowService {
  private readonly receivables = new Map<string, ReceivableRecord>();
  private readonly payables = new Map<string, PayableRecord>();
  private readonly transactions = new Map<string, TransactionRecord>(); // key eventId
  private readonly transactionsById = new Map<string, TransactionRecord>();
  private readonly snapshots = new Map<string, ProjectionSnapshot>(); // key orgId:horizon
  private readonly grants: FinanceGrant[] = [];
  readonly metrics = new FinanceMetrics();

  constructor(private readonly audit: AuditService) {}

  // --- ingest PaymentConfirmed (fan-out billing → finance) ------------------
  // Idempotente por eventId (UNIQUE(eventId)): replay retorna o mesmo trio
  // sem duplicar Receivable/Transaction/saldo.

  ingestPaymentConfirmed(input: {
    eventId: string;
    orgId: string;
    externalId: string;
    amountCents: number;
    paidAt: string;
    actorId?: string;
  }): { receivable: ReceivableRecord; transaction: TransactionRecord; duplicate: boolean } {
    const existingTx = this.transactions.get(input.eventId);
    if (existingTx) {
      const receivable = this.receivables.get(existingTx.refId);
      this.metrics.inc('finance.ingest.duplicate');
      this.metrics.inc('finance.transaction.duplicate');
      return { receivable: receivable!, transaction: existingTx, duplicate: true };
    }
    const now = new Date().toISOString();
    const receivable: ReceivableRecord = {
      id: randomUUID(),
      orgId: input.orgId,
      externalId: input.externalId,
      amountCents: input.amountCents,
      status: 'RECEBIDO',
      dueDate: null,
      paidAt: input.paidAt,
      eventId: input.eventId,
      createdAt: now,
    };
    const transaction: TransactionRecord = {
      id: randomUUID(),
      orgId: input.orgId,
      kind: 'INCOME',
      amountCents: input.amountCents,
      refKind: 'receivable',
      refId: receivable.id,
      eventId: input.eventId,
      createdAt: now,
    };
    this.receivables.set(receivable.id, receivable);
    this.transactions.set(input.eventId, transaction);
    this.transactionsById.set(transaction.id, transaction);
    this.metrics.inc('finance.ingest.applied');
    this.metrics.inc('finance.transaction.posted');
    this.metrics.inc('finance.receivable.received');
    this.audit.emit({
      actorId: input.actorId,
      action: 'finance.transaction.posted',
      entity: 'transaction',
      entityId: transaction.id,
      metadata: {
        actorId: input.actorId,
        orgId: input.orgId,
        amountCents: input.amountCents,
        kind: 'INCOME',
        eventId: input.eventId,
      },
    });
    this.invalidateSnapshotsFor(input.orgId);
    return { receivable, transaction, duplicate: false };
  }

  // --- previsto/pendente + baixas manuais (idempotentes por estado) ---------

  createReceivable(input: {
    orgId: string;
    amountCents: number;
    externalId?: string;
    kind?: string;
    dueDate?: string;
  }): ReceivableRecord {
    const now = new Date().toISOString();
    const status: ReceivableStatus = input.kind === 'previsto' ? 'PREVISTO' : 'PENDENTE';
    const row: ReceivableRecord = {
      id: randomUUID(),
      orgId: input.orgId,
      externalId: input.externalId ?? null,
      amountCents: input.amountCents,
      status,
      dueDate: input.dueDate ?? null,
      paidAt: null,
      eventId: null,
      createdAt: now,
    };
    this.receivables.set(row.id, row);
    return row;
  }

  markReceived(id: string, opts: { paidAt?: string; eventId?: string; actorId?: string } = {}): ReceivableRecord {
    const row = this.receivables.get(id);
    if (!row) throw new Error(`receivable ${id} não encontrado`);
    if (row.status === 'RECEBIDO') return row; // replay idempotente: sem nova Transaction
    const eventId = opts.eventId ?? `manual-receive:${row.id}`;
    const dup = this.transactions.get(eventId);
    if (dup) {
      row.status = 'RECEBIDO';
      return row;
    }
    const now = new Date().toISOString();
    row.status = 'RECEBIDO';
    row.paidAt = opts.paidAt ?? now;
    row.eventId = eventId;
    const tx: TransactionRecord = {
      id: randomUUID(),
      orgId: row.orgId,
      kind: 'INCOME',
      amountCents: row.amountCents,
      refKind: 'receivable',
      refId: row.id,
      eventId,
      createdAt: now,
    };
    this.transactions.set(eventId, tx);
    this.transactionsById.set(tx.id, tx);
    this.metrics.inc('finance.transaction.posted');
    this.metrics.inc('finance.receivable.received');
    this.audit.emit({
      actorId: opts.actorId,
      action: 'finance.transaction.posted',
      entity: 'transaction',
      entityId: tx.id,
      metadata: {
        actorId: opts.actorId,
        orgId: row.orgId,
        amountCents: row.amountCents,
        kind: 'INCOME',
        eventId,
      },
    });
    this.invalidateSnapshotsFor(row.orgId);
    return row;
  }

  createPayable(input: { orgId: string; amountCents: number; kind?: string; dueDate?: string }): PayableRecord {
    const now = new Date().toISOString();
    const status: PayableStatus = input.kind === 'previsto' ? 'PREVISTO' : 'PENDENTE';
    const row: PayableRecord = {
      id: randomUUID(),
      orgId: input.orgId,
      amountCents: input.amountCents,
      status,
      dueDate: input.dueDate ?? null,
      paidAt: null,
      eventId: null,
      createdAt: now,
    };
    this.payables.set(row.id, row);
    return row;
  }

  markPaid(id: string, opts: { paidAt?: string; eventId?: string; actorId?: string } = {}): PayableRecord {
    const row = this.payables.get(id);
    if (!row) throw new Error(`payable ${id} não encontrado`);
    if (row.status === 'PAGO') return row; // replay idempotente
    const eventId = opts.eventId ?? `manual-pay:${row.id}`;
    const dup = this.transactions.get(eventId);
    if (dup) {
      row.status = 'PAGO';
      return row;
    }
    const now = new Date().toISOString();
    row.status = 'PAGO';
    row.paidAt = opts.paidAt ?? now;
    row.eventId = eventId;
    const tx: TransactionRecord = {
      id: randomUUID(),
      orgId: row.orgId,
      kind: 'EXPENSE',
      amountCents: row.amountCents,
      refKind: 'payable',
      refId: row.id,
      eventId,
      createdAt: now,
    };
    this.transactions.set(eventId, tx);
    this.transactionsById.set(tx.id, tx);
    this.metrics.inc('finance.transaction.posted');
    this.metrics.inc('finance.payable.paid');
    this.audit.emit({
      actorId: opts.actorId,
      action: 'finance.transaction.posted',
      entity: 'transaction',
      entityId: tx.id,
      metadata: {
        actorId: opts.actorId,
        orgId: row.orgId,
        amountCents: row.amountCents,
        kind: 'EXPENSE',
        eventId,
      },
    });
    this.invalidateSnapshotsFor(row.orgId);
    return row;
  }

  getReceivable(id: string): ReceivableRecord | undefined {
    return this.receivables.get(id);
  }

  getPayable(id: string): PayableRecord | undefined {
    return this.payables.get(id);
  }

  listTransactions(orgId?: string): TransactionRecord[] {
    const all = [...this.transactionsById.values()];
    return orgId ? all.filter((t) => t.orgId === orgId) : all;
  }

  // --- saldo: SÓ de Transactions (único mutador) ----------------------------

  getBalance(orgId: string): { orgId: string; balanceCents: number; incomeCents: number; expenseCents: number } {
    let incomeCents = 0;
    let expenseCents = 0;
    for (const tx of this.transactionsById.values()) {
      if (tx.orgId !== orgId) continue;
      if (tx.kind === 'INCOME') incomeCents += tx.amountCents;
      else expenseCents += tx.amountCents;
    }
    return { orgId, balanceCents: incomeCents - expenseCents, incomeCents, expenseCents };
  }

  // --- projeções: hit (200) / miss (202 computing) --------------------------

  peekProjection(orgId: string, horizonDays: number): { hit: boolean; snapshot: ProjectionSnapshot | null } {
    const snap = this.snapshots.get(projectionKey(orgId, horizonDays)) ?? null;
    if (snap && Date.parse(snap.expiresAt) > Date.now()) {
      this.metrics.inc('finance.projection.hit');
      return { hit: true, snapshot: snap };
    }
    this.metrics.inc('finance.projection.miss');
    return { hit: false, snapshot: null };
  }

  computeProjection(orgId: string, horizonDays: number): ProjectionSnapshot {
    const { balanceCents } = this.getBalance(orgId);
    let pendingCents = 0;
    for (const r of this.receivables.values()) {
      if (r.orgId !== orgId) continue;
      if (r.status === 'PENDENTE' || r.status === 'PREVISTO') pendingCents += r.amountCents;
    }
    let forecastCents = balanceCents + pendingCents;
    for (const p of this.payables.values()) {
      if (p.orgId !== orgId) continue;
      if (p.status === 'PENDENTE' || p.status === 'PREVISTO') forecastCents -= p.amountCents;
    }
    const now = new Date();
    const snapshot: ProjectionSnapshot = {
      id: randomUUID(),
      orgId,
      horizonDays,
      premisesHash: premisesHashFor({
        orgId,
        horizonDays,
        realizedCents: balanceCents,
        pendingCents,
        forecastCents,
      }),
      realizedCents: balanceCents,
      pendingCents,
      forecastCents,
      computedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PROJECTION_TTL_MS).toISOString(),
    };
    this.snapshots.set(projectionKey(orgId, horizonDays), snapshot);
    this.metrics.inc('finance.projection.computed');
    return snapshot;
  }

  /** Ticker do worker: remove snapshots expirados; retorna invalidados. */
  invalidateExpiredSnapshots(nowMs = Date.now()): string[] {
    const gone: string[] = [];
    for (const [key, snap] of this.snapshots.entries()) {
      if (Date.parse(snap.expiresAt) <= nowMs) {
        this.snapshots.delete(key);
        gone.push(key);
      }
    }
    return gone;
  }

  private invalidateSnapshotsFor(orgId: string): void {
    for (const [key, snap] of this.snapshots.entries()) {
      if (snap.orgId === orgId) this.snapshots.delete(key);
    }
  }

  // --- concessões finance.read (escopadas, auditadas, sem PII) --------------

  grantRead(input: { orgId: string; grantee: string; reason: string; actorId?: string }): FinanceGrant {
    const grant: FinanceGrant = {
      id: randomUUID(),
      orgId: input.orgId,
      grantee: input.grantee,
      reason: input.reason,
      actorId: input.actorId ?? 'admin',
      createdAt: new Date().toISOString(),
    };
    this.grants.push(grant);
    this.audit.emit({
      actorId: grant.actorId,
      action: 'finance.read.grant',
      entity: 'finance_grant',
      entityId: grant.id,
      metadata: { actorId: grant.actorId, orgId: input.orgId, reason: input.reason },
    });
    return grant;
  }

  listGrants(orgId?: string): FinanceGrant[] {
    return orgId ? this.grants.filter((g) => g.orgId === orgId) : [...this.grants];
  }
}
