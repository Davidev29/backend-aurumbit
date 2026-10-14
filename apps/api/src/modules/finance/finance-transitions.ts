// Transições Finance (Fase 5, PROJECT.md §5 — mesmo padrão de billing-transitions).
// Ilegal → `IllegalTransitionError` (o service converte em 422 + alerta,
// SEM sobrescrever a linha). No-op `from === to` = replay idempotente.

export type FinanceAggregate = 'receivable' | 'payable';

export const RECEIVABLE_STATUSES = [
  'PREVISTO',
  'PENDENTE',
  'RECEBIDO',
  'CANCELADO',
  'INADIMPLENTE',
] as const;

export const PAYABLE_STATUSES = ['PREVISTO', 'PENDENTE', 'PAGO', 'CANCELADO'] as const;

export const CATEGORY_TYPES = ['INCOME', 'EXPENSE'] as const;
export const ACCOUNT_TYPES = ['CASH', 'BANK', 'ASAAS_WALLET'] as const;
export const RECEIVABLE_SOURCES = ['INVOICE', 'MANUAL'] as const;
export const PAYABLE_SOURCES = ['REFUND', 'MANUAL', 'SUPPLIER'] as const;
export const TRANSACTION_KINDS = ['INCOME', 'EXPENSE'] as const;
export const TRANSACTION_PROVIDERS = ['ASAAS', 'MANUAL'] as const;
export const PROJECTION_SCOPES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;

export class IllegalTransitionError extends Error {
  readonly aggregate: FinanceAggregate;
  readonly from: string;
  readonly to: string;
  readonly allowed: readonly string[];

  constructor(aggregate: FinanceAggregate, from: string, to: string, allowed: readonly string[]) {
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

const FINANCE_FLOWS: Record<FinanceAggregate, Record<string, string[]>> = {
  receivable: {
    PREVISTO: ['PENDENTE', 'RECEBIDO', 'CANCELADO'],
    PENDENTE: ['RECEBIDO', 'CANCELADO', 'INADIMPLENTE', 'PREVISTO'],
    INADIMPLENTE: ['RECEBIDO', 'CANCELADO'],
    RECEBIDO: [],
    CANCELADO: [],
  },
  payable: {
    PREVISTO: ['PENDENTE', 'PAGO', 'CANCELADO'],
    PENDENTE: ['PAGO', 'CANCELADO', 'PREVISTO'],
    PAGO: [],
    CANCELADO: [],
  },
};

/** Retorna true se `from → to` é permitida (inclui no-op `from === to`). */
export function canTransition(aggregate: FinanceAggregate, from: string, to: string): boolean {
  if (from === to) return true; // replay idempotente do mesmo estado
  return FINANCE_FLOWS[aggregate]?.[from]?.includes(to) ?? false;
}

/** Lança `IllegalTransitionError` se `from → to` for ilegal no agregado. */
export function assertTransition(aggregate: FinanceAggregate, from: string, to: string): void {
  const allowed = FINANCE_FLOWS[aggregate]?.[from];
  if (!allowed) {
    throw new IllegalTransitionError(aggregate, from, to, []);
  }
  if (from !== to && !allowed.includes(to)) {
    throw new IllegalTransitionError(aggregate, from, to, allowed);
  }
}
