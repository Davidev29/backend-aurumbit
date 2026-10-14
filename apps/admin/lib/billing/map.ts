import type {
  InvoiceStatus,
  InvoiceView,
  PaymentStatus,
  PaymentView,
  SubscriptionStatus,
  SubscriptionView,
} from "../types";

/**
 * Mapeamento Nest (billing PG, camelCase, centavos) → views do Admin.
 * Regras honestas:
 * - centavos ÷ 100; `provider` fixo ASAAS (sandbox-first, único provider);
 * - `correlationId` sintético estável (`inv:`/`sub:`/`pay:` + id) até o
 *   correlation real do webhook (PROJECT §5) — documentado, nunca colide;
 * - PENDING com vencimento passado exibe OVERDUE (fato temporal; o estado no
 *   backend segue intacto);
 * - DRAFT/SUSPENDED passam como estão (badges dedicados na UI);
 * - pagamentos transitórios (PROCESSING/AWAITING/EXPIRED/CANCELLED/CHARGEBACK)
 *   agrupam em PENDING (detalhe preservado no `externalId`/id).
 */

export interface NestInvoiceRow {
  id: string;
  number?: string | null;
  customerId: string;
  subscriptionId?: string | null;
  orderId?: string | null;
  asaasInvoiceId?: string | null;
  status: string;
  amountCents: number;
  dueDate?: string | null;
  paidAt?: string | null;
  createdAt: string;
}

export interface NestPaymentRow {
  id: string;
  provider?: string | null;
  externalId: string;
  customerId: string;
  invoiceId?: string | null;
  amountCents: number;
  method?: string | null;
  status: string;
  paidAt?: string | null;
  createdAt: string;
}

export interface NestSubscriptionRow {
  id: string;
  customerId: string;
  asaasSubscriptionId?: string | null;
  status: string;
  planRef?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  canceledAt?: string | null;
  createdAt: string;
  lastInvoiceAmountCents?: number | null;
  lastInvoiceDueDate?: string | null;
}

const INVOICE_STATUSES: InvoiceStatus[] = ["DRAFT", "PENDING", "PAID", "OVERDUE", "REFUNDED", "CANCELLED"];
const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "DRAFT",
  "ACTIVE",
  "PAST_DUE",
  "SUSPENDED",
  "CANCELLED",
  "EXPIRED",
  "TRIAL",
];

export function toInvoiceStatus(raw: string, dueDate?: string | null): InvoiceStatus {
  const s = (raw ?? "").toUpperCase();
  if (INVOICE_STATUSES.includes(s as InvoiceStatus)) {
    if (s === "PENDING" && dueDate && Date.parse(dueDate) < Date.now()) return "OVERDUE";
    return s as InvoiceStatus;
  }
  return "PENDING";
}

export function toSubscriptionStatus(raw: string): SubscriptionStatus {
  const s = (raw ?? "").toUpperCase();
  if (SUBSCRIPTION_STATUSES.includes(s as SubscriptionStatus)) return s as SubscriptionStatus;
  return "ACTIVE";
}

export function toPaymentStatus(raw: string): PaymentStatus {
  const s = (raw ?? "").toUpperCase();
  if (s === "CONFIRMED" || s === "REFUNDED" || s === "FAILED") return s;
  return "PENDING";
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export function toInvoiceView(row: NestInvoiceRow, customerName: string): InvoiceView {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName,
    amount: Math.round(row.amountCents) / 100,
    currency: "BRL",
    status: toInvoiceStatus(row.status, row.dueDate),
    dueDate: row.dueDate ?? new Date().toISOString(),
    paidAt: row.paidAt ?? null,
    externalId: row.asaasInvoiceId ?? row.orderId ?? row.number ?? row.id,
    provider: "ASAAS",
    correlationId: `inv:${row.id}`,
    createdAt: row.createdAt,
  };
}

export function toPaymentView(row: NestPaymentRow, correlationId: string): PaymentView {
  return {
    id: row.id,
    invoiceId: row.invoiceId ?? "",
    externalId: row.externalId,
    amount: Math.round(row.amountCents) / 100,
    currency: "BRL",
    status: toPaymentStatus(row.status),
    method: row.method ?? undefined,
    paidAt: row.paidAt ?? null,
    correlationId,
    createdAt: row.createdAt,
  };
}

export function toSubscriptionView(row: NestSubscriptionRow, customerName: string): SubscriptionView {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName,
    planName: row.planRef ?? "—",
    status: toSubscriptionStatus(row.status),
    amount:
      typeof row.lastInvoiceAmountCents === "number" ? Math.round(row.lastInvoiceAmountCents) / 100 : 0,
    currency: "BRL",
    nextDue: row.lastInvoiceDueDate ?? row.currentPeriodEnd ?? "",
    externalId: row.asaasSubscriptionId ?? row.id,
    correlationId: `sub:${row.id}`,
    createdAt: row.createdAt,
    cancelledAt: row.canceledAt ?? null,
  };
}

/**
 * Nome do titular via espelho `GET /v1/billing/customers/:userId` (com cache
 * por request). Ausente → `shortId` (honesto, nunca inventa nome).
 */
export async function resolveCustomerNames(
  base: string,
  headers: Record<string, string>,
  customerIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    Array.from(new Set(customerIds)).map(async (id) => {
      try {
        const res = await fetch(`${base}/v1/billing/customers/${encodeURIComponent(id)}`, { headers });
        if (!res.ok) {
          out.set(id, `Cliente ${shortId(id)}`);
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { name?: unknown; email?: unknown };
        out.set(
          id,
          typeof data.name === "string" && data.name ? data.name : `Cliente ${shortId(id)}`,
        );
      } catch {
        out.set(id, `Cliente ${shortId(id)}`);
      }
    }),
  );
  return out;
}
