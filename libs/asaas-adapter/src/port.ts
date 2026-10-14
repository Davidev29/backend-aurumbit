/**
 * Porta do provider de cobrança (Fase 4, REQUIREMENTS.md §3).
 * O billing core depende DESTA interface (nunca do adapter concreto):
 * `AsaasProviderAdapter` a implementa; testes usam fakes.
 * IDs cross-DB são opacos (sem FK cross-DB, PROJECT.md).
 */

export type AsaasBillingType = 'PIX' | 'BOLETO' | 'CREDIT_CARD' | 'UNDEFINED';
export type AsaasCycle =
  'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';

export interface BillingCustomerInput {
  name: string;
  email?: string;
  cpfCnpj?: string;
  /** Referência opaca ao titular interno (customers.Customer.id). */
  externalReference?: string;
}

export interface BillingCustomer {
  id: string;
  name: string;
  email?: string | null;
}

export interface BillingChargeInput {
  /** `id` do customer NO Asaas (`cus_*`). */
  customerId: string;
  /** Valor em centavos (convertido p/ reais na borda do adapter). */
  valueCents: number;
  /** Vencimento ISO (YYYY-MM-DD). */
  dueDate: string;
  billingType?: AsaasBillingType;
  description?: string;
  /** Referência opaca interna (ex. invoiceId) — idempotência natural. */
  externalReference?: string;
}

export interface BillingCharge {
  id: string;
  status: string;
  valueCents: number;
  dueDate?: string | null;
}

export interface BillingSubscriptionInput {
  customerId: string;
  valueCents: number;
  /** Próximo vencimento ISO (YYYY-MM-DD). */
  nextDueDate: string;
  cycle?: AsaasCycle;
  billingType?: AsaasBillingType;
  description?: string;
  externalReference?: string;
}

export interface BillingSubscription {
  id: string;
  status: string;
}

export interface BillingPaymentStatus {
  id: string;
  /** Status bruto do Asaas (`PENDING`, `RECEIVED`, `CONFIRMED`, `OVERDUE`, `REFUNDED`, ...). */
  status: string;
  valueCents: number;
}

export interface ListPaymentsParams {
  offset?: number;
  limit?: number;
  /** Filtro opcional por status bruto do Asaas. */
  status?: string;
}

export interface ListPaymentsResult {
  data: BillingPaymentStatus[];
  hasMore: boolean;
  totalCount?: number;
}

/** Porta implementada pelo `AsaasProviderAdapter` (e por fakes em teste). */
export interface BillingProviderPort {
  createCustomer(input: BillingCustomerInput): Promise<BillingCustomer>;
  /** Cobra (payment avulso). */
  createCharge(input: BillingChargeInput): Promise<BillingCharge>;
  createSubscription(input: BillingSubscriptionInput): Promise<BillingSubscription>;
  cancelSubscription(subscriptionId: string): Promise<{ id: string; status: string }>;
  /** Estorna total ou parcial (valueCents ausente = total). */
  refundCharge(paymentId: string, valueCents?: number): Promise<{ id: string; status: string }>;
  getPaymentStatus(paymentId: string): Promise<BillingPaymentStatus>;
  /** Página p/ reconciliação (hourly/daily, PROJECT.md §5). */
  listPayments(params?: ListPaymentsParams): Promise<ListPaymentsResult>;
}
