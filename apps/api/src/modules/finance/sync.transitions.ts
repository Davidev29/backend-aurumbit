// Transições/guards do sync billing→finance (Fase 5, PROJECT.md §5).
// Puro (sem I/O): normalização de tópicos, guarda fora-de-ordem e
// classificação parcial/total de reembolso. O `FinanceSyncService`
// aplica; aqui só decisão testável sem PG.

/** Tipos canônicos consumidos pelo FinanceSyncService. */
export const FINANCE_CONSUMED_TYPES = [
  'PaymentConfirmed',
  'PaymentFailed',
  'PaymentExpired',
  'InvoiceOverdue',
  'RefundCompleted',
  'SubscriptionActivated',
  'SubscriptionCancelled',
] as const;

export type FinanceConsumedType = (typeof FINANCE_CONSUMED_TYPES)[number];

/**
 * Normaliza o `type`/`topic` do envelope billing (o core emite
 * `PaymentConfirmed`; a reconciliação/relay pode usar o tópico
 * `billing.payment.confirmed.v1`). Desconhecido → null (noop, sem erro:
 * o consumidor ignora sem DLQ — decisão de negócio, não falha).
 */
export function normalizeFinanceTopic(raw: string): FinanceConsumedType | null {
  switch (raw) {
    case 'PaymentConfirmed':
    case 'billing.payment.confirmed.v1':
      return 'PaymentConfirmed';
    case 'PaymentFailed':
    case 'billing.payment.failed.v1':
      return 'PaymentFailed';
    case 'PaymentExpired':
    case 'billing.payment.expired.v1':
      return 'PaymentExpired';
    case 'InvoiceOverdue':
    case 'billing.invoice.overdue.v1':
      return 'InvoiceOverdue';
    case 'RefundCompleted':
    case 'billing.refund.completed.v1':
      return 'RefundCompleted';
    case 'SubscriptionActivated':
    case 'billing.subscription.activated.v1':
      return 'SubscriptionActivated';
    case 'SubscriptionCancelled':
    case 'billing.subscription.cancelled.v1':
      return 'SubscriptionCancelled';
    default:
      return null;
  }
}

// --- terminais financeiros (nunca regridem) -------------------------------

export const RECEIVABLE_TERMINAL = ['RECEBIDO'] as const;
export const PAYABLE_TERMINAL = ['PAGO'] as const;

/** Linha já terminal: qualquer evento econômico posterior é no-op. */
export function isFinanceTerminal(status: string): boolean {
  return (RECEIVABLE_TERMINAL as readonly string[]).includes(status) ||
    (PAYABLE_TERMINAL as readonly string[]).includes(status);
}

/**
 * Guarda fora-de-ordem por `occurredAt`/`version`: evento com marca
 * temporal/versão mais antiga que a registrada não aplica. Quando não há
 * marca comparável, só o terminal bloqueia (nunca regride RECEBIDO/PAGO).
 * Retorna `{ apply: false, reason }` quando deve ignorar.
 */
export function shouldApplyFinanceEvent(input: {
  currentStatus: string;
  currentOccurredAt?: string | Date | null;
  currentVersion?: number | null;
  incomingOccurredAt?: string | Date | null;
  incomingVersion?: number | null;
}): { apply: true } | { apply: false; reason: string } {
  if (isFinanceTerminal(input.currentStatus)) {
    return { apply: false, reason: `terminal:${input.currentStatus}` };
  }
  if (input.incomingVersion != null && input.currentVersion != null) {
    if (input.incomingVersion < input.currentVersion) {
      return {
        apply: false,
        reason: `stale-version:${input.incomingVersion}<${input.currentVersion}`,
      };
    }
  }
  if (input.incomingOccurredAt != null && input.currentOccurredAt != null) {
    const inc = new Date(input.incomingOccurredAt).getTime();
    const cur = new Date(input.currentOccurredAt).getTime();
    if (Number.isFinite(inc) && Number.isFinite(cur) && inc < cur) {
      return { apply: false, reason: 'stale-occurredAt' };
    }
  }
  return { apply: true };
}

// --- reembolso parcial vs total -------------------------------------------

export type RefundClassification = 'PARTIALLY_REFUNDED' | 'REFUNDED';

/**
 * Classifica o reembolso frente ao valor pago. `refundedTotalCents` =
 * soma de TODOS os refunds COMPLETED do pagamento (incluindo este);
 * sem ele, compara só este refund (melhor-effort).
 */
export function classifyRefund(input: {
  refundAmountCents: number;
  paymentAmountCents?: number | null;
  refundedTotalCents?: number | null;
}): RefundClassification {
  const total = input.refundedTotalCents ?? input.refundAmountCents;
  if (input.paymentAmountCents != null && total < input.paymentAmountCents) {
    return 'PARTIALLY_REFUNDED';
  }
  return 'REFUNDED';
}

/** Vencido? `dueDate <= now` (comparação em ms; data inválida → false). */
export function isOverdue(dueDate: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (dueDate == null) return false;
  const t = new Date(dueDate).getTime();
  return Number.isFinite(t) && t <= now.getTime();
}
