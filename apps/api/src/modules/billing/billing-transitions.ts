// Transições Billing (Fase 4, PROJECT.md §5).
// Núcleo compartilhado por billing.service (PG) e billing-flow.service
// (memória/e2e). Ilegal → `IllegalTransitionError` (o chamador converte em
// 422/REJECTED + alerta, SEM sobrescrever a linha).
//
// PARTE 1 — agregados PG (`BillingAggregate` + `assertTransition` +
// `buildInvoiceNumber`, usados por `billing.service.ts`). Mapas = UNIÃO do
// núcleo de cobrança (Invoice/DRAFT→…/PAST_DUE/PROCESSING/CHARGEBACK —
// REQUIREMENTS.md §3) com o fluxo canônico Order→Payment (DRAFT→PAID
// direto, APPROVED/REJECTED de refund — workstream fluxo/webhook).
// Ampliar é compatível; estreitar quebra o outro workstream.
// PARTE 2 — webhook/pagamento para o fluxo canônico + workers (outro
// workstream; não alterar): `PAYMENT_FLOW`, eventos Asaas,
// `PaymentConfirmed`, recon.

// --- PARTE 1: agregados PG -------------------------------------------------

export type BillingAggregate = 'invoice' | 'subscription' | 'payment' | 'refund' | 'webhook';

export const SUBSCRIPTION_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
] as const;

export const INVOICE_STATUSES = [
  'DRAFT',
  'PENDING',
  'PAID',
  'OVERDUE',
  'CANCELLED',
  'REFUNDED',
] as const;

// (Movidas p/ após AGGREGATE_FLOWS: derivadas das chaves p/ nunca divergir.)

// Terminais: nunca regridem (PROJECT.md §5 — evento antigo/fora de ordem
// não tira o agregado do terminal).
export const TERMINAL_STATUSES: Record<string, readonly string[]> = {
  subscription: ['CANCELLED', 'EXPIRED'],
  invoice: ['CANCELLED', 'REFUNDED'],
  payment: ['REFUNDED', 'CHARGEBACK'],
  refund: ['COMPLETED'],
};

export class IllegalTransitionError extends Error {
  readonly aggregate: BillingAggregate;
  readonly from: string;
  readonly to: string;
  readonly allowed: readonly string[];

  constructor(aggregate: BillingAggregate, from: string, to: string, allowed: readonly string[]) {
    super(
      `transição ilegal em ${aggregate}: ${from} → ${to} ` +
        `(permitidas: ${allowed.length > 0 ? allowed.join(', ') : 'nenhuma — estado terminal'})`,
    );
    this.name = 'IllegalTransitionError';
    this.aggregate = aggregate;
    this.from = from;
    this.to = to;
    this.allowed = allowed;
  }
}

const AGGREGATE_FLOWS: Record<BillingAggregate, Record<string, string[]>> = {
  invoice: {
    DRAFT: ['PENDING', 'OVERDUE', 'PAID', 'CANCELLED'],
    PENDING: ['PAID', 'OVERDUE', 'CANCELLED'],
    OVERDUE: ['PAID', 'CANCELLED'],
    PAID: ['REFUNDED'],
    CANCELLED: [],
    REFUNDED: [],
  },
  subscription: {
    DRAFT: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'],
    PAST_DUE: ['ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'],
    SUSPENDED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
    CANCELLED: [],
    EXPIRED: [],
  },
  payment: {
    PENDING: ['PROCESSING', 'AWAITING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED'],
    PROCESSING: ['AWAITING', 'CONFIRMED', 'FAILED', 'EXPIRED'],
    AWAITING: ['CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED'],
    CONFIRMED: ['REFUNDED', 'CHARGEBACK'],
    FAILED: ['PENDING', 'CANCELLED'],
    EXPIRED: ['PENDING'],
    REFUNDED: [],
    CHARGEBACK: [],
    CANCELLED: [],
  },
  refund: {
    REQUESTED: ['PROCESSING', 'FAILED', 'APPROVED', 'REJECTED', 'COMPLETED'],
    PROCESSING: ['COMPLETED', 'FAILED'],
    APPROVED: ['COMPLETED'],
    FAILED: ['REQUESTED'],
    REJECTED: [],
    COMPLETED: [],
  },
  webhook: {
    RECEIVED: ['VALIDATED', 'REJECTED', 'DUPLICATE'],
    VALIDATED: ['APPLIED', 'REJECTED', 'DUPLICATE'],
    APPLIED: [],
    REJECTED: [],
    DUPLICATE: [],
  },
};

// Status válidos derivados das chaves dos fluxos (fonte única — sem drift).
export const PAYMENT_STATUSES = Object.keys(AGGREGATE_FLOWS.payment);
export const REFUND_STATUSES = Object.keys(AGGREGATE_FLOWS.refund);
export const WEBHOOK_STATUSES = Object.keys(AGGREGATE_FLOWS.webhook);

/** Retorna true se `from → to` é permitida (inclui no-op `from === to`). */
export function canTransition(aggregate: BillingAggregate, from: string, to: string): boolean {
  if (from === to) return true; // replay idempotente do mesmo estado
  return AGGREGATE_FLOWS[aggregate]?.[from]?.includes(to) ?? false;
}

/** Lança `IllegalTransitionError` se `from → to` for ilegal no agregado. */
export function assertTransition(aggregate: BillingAggregate, from: string, to: string): void {
  const allowed = AGGREGATE_FLOWS[aggregate]?.[from];
  if (!allowed) {
    throw new IllegalTransitionError(aggregate, from, to, []);
  }
  if (from !== to && !allowed.includes(to)) {
    throw new IllegalTransitionError(aggregate, from, to, allowed);
  }
}

/**
 * Número de fatura `INV-<ano>-<6 dígitos>` (colisão → regenera no service).
 * `rand6` injetável p/ testes determinísticos.
 */
export function buildInvoiceNumber(year: number, rand6?: () => string): string {
  const suffix =
    rand6?.() ?? String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  if (!/^\d{6}$/.test(suffix)) throw new Error('rand6 deve produzir 6 dígitos');
  return `INV-${year}-${suffix}`;
}

// --- PARTE 2: webhook + pagamento (fluxo canônico / workers) ----------------

export const WEBHOOK_FLOW = ['RECEIVED', 'VALIDATED', 'APPLIED', 'REJECTED', 'DUPLICATE'] as const;
export type WebhookStatus = (typeof WEBHOOK_FLOW)[number];

export const PAYMENT_FLOW: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'FAILED', 'CANCELLED'],
  FAILED: ['PENDING', 'CANCELLED'],
  CONFIRMED: ['REFUNDED'],
  REFUNDED: [],
  CANCELLED: [],
};

export const TERMINAL_PAYMENT = ['CONFIRMED', 'REFUNDED'] as const;

export function assertPaymentTransition(from: string, to: string): { ok: true } | { ok: false; reason: string } {
  const allowed = PAYMENT_FLOW[from] ?? AGGREGATE_FLOWS.payment[from];
  if (!allowed) return { ok: false, reason: `estado de pagamento desconhecido: ${from}` };
  if (!allowed.includes(to)) {
    return { ok: false, reason: `transição pagamento ${from} → ${to} ilegal` };
  }
  return { ok: true };
}

export function isTerminalPayment(status: string): boolean {
  return (TERMINAL_PAYMENT as readonly string[]).includes(status);
}

/** Rank p/ guarda fora-de-ordem (evento antigo nunca regride terminal). */
const PAYMENT_RANK: Record<string, number> = {
  PENDING: 0,
  FAILED: 1,
  CANCELLED: 1,
  AWAITING: 1,
  CONFIRMED: 2,
  REFUNDED: 3,
};

export function isOutOfOrderRegression(current: string, incoming: string): boolean {
  if (!isTerminalPayment(current)) return false;
  return (PAYMENT_RANK[incoming] ?? -1) < (PAYMENT_RANK[current] ?? 0);
}

// --- eventos Asaas (mock Sandbox-first) ------------------------------------

export type AsaasPaymentEvent =
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_OVERDUE'
  | 'PAYMENT_DELETED';

export interface AsaasWebhookPayload {
  event: AsaasPaymentEvent | string;
  payment: {
    id: string;
    value?: number;
    dateCreated?: string;
    confirmedDate?: string;
    dueDate?: string;
  };
  version?: number;
  occurredAt?: string;
}

/** Mapeia evento Asaas → estado de pagamento alvo (desconhecido → null = REJECT). */
export function paymentTargetForAsaasEvent(event: string): string | null {
  switch (event) {
    case 'PAYMENT_CONFIRMED':
    case 'PAYMENT_RECEIVED':
      return 'CONFIRMED';
    case 'PAYMENT_REFUNDED':
      return 'REFUNDED';
    case 'PAYMENT_OVERDUE':
    case 'PAYMENT_DELETED':
      return 'FAILED';
    default:
      return null;
  }
}

/** Tópico canônico do outbox para o estado aplicado. */
export function outboxTypeForPaymentStatus(status: string): string | null {
  switch (status) {
    case 'CONFIRMED':
      return 'billing.payment.confirmed.v1';
    case 'FAILED':
      return 'billing.payment.failed.v1';
    case 'REFUNDED':
      return 'billing.payment.refunded.v1';
    default:
      return null;
  }
}

/** eventId determinístico da confirmação (idempotente no replay). */
export function paymentConfirmedEventId(externalId: string): string {
  return `billing-payment-confirmed:${externalId}`;
}

/** eventId sintético da reconciliação (mesmo pipeline, PROJECT.md §5). */
export function reconEventId(paymentId: string, day: string): string {
  return `recon:${paymentId}:${day}`;
}

export function isReconEventId(eventId: string): boolean {
  return eventId.startsWith('recon:');
}
