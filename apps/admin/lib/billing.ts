import { apiGet, apiPost } from "./api/client";
import type {
  AuditEventView,
  CancelSubscriptionRequest,
  InvoiceDetail,
  InvoiceView,
  Page,
  RefundInvoiceRequest,
  SubscriptionStatus,
  SubscriptionView,
} from "./types";
import type { AuditFilters, InvoiceFilters } from "./mocks";

// Re-exporta os filtros (fonte: `lib/mocks.ts`, espelho dos query DTOs do Nest).
export type { InvoiceFilters, AuditFilters };

/**
 * Ações de billing via BFF (`/api/billing/*` → Nest `/v1/billing/*` quando
 * `API_INTERNAL_URL` está configurado; stub auditado em `lib/mocks.ts` senão).
 *
 * POSTs sempre carregam `Idempotency-Key` (PROJECT §5). Sem financeiro
 * realizado: cancel/refund só mutam estado de cobrança + audit (Fase 5
 * projeta previsto/pendente/realizado).
 */
function idempotencyHeaders(): Record<string, string> {
  const key =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { "Idempotency-Key": key };
}

function toQuery(params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function listInvoices(
  filters: InvoiceFilters,
  cursor: string | null,
): Promise<Page<InvoiceView>> {
  return apiGet<Page<InvoiceView>>(
    `/api/billing/invoices${toQuery({
      status: filters.status ?? undefined,
      dueFrom: filters.dueFrom ?? undefined,
      dueTo: filters.dueTo ?? undefined,
      cursor: cursor ?? undefined,
    })}`,
  );
}

export function getInvoice(id: string): Promise<InvoiceDetail> {
  return apiGet<InvoiceDetail>(`/api/billing/invoices/${encodeURIComponent(id)}`);
}

/** Estorno (exige `billing.manage`; motivo >= 10 + confirmação na UI). */
export function refundInvoice(
  id: string,
  req: RefundInvoiceRequest,
): Promise<{ refundId: string; auditId: string; status: string }> {
  return apiPost(
    `/api/billing/invoices/${encodeURIComponent(id)}/refund`,
    req,
    { headers: idempotencyHeaders() },
  );
}

export function listSubscriptions(
  status: SubscriptionStatus | null,
  cursor: string | null,
): Promise<Page<SubscriptionView>> {
  return apiGet<Page<SubscriptionView>>(
    `/api/billing/subscriptions${toQuery({ status: status ?? undefined, cursor: cursor ?? undefined })}`,
  );
}

/** Cancelamento (exige `billing.manage`; motivo >= 10 + confirmação na UI). */
export function cancelSubscription(
  id: string,
  req: CancelSubscriptionRequest,
): Promise<{ subscriptionId: string; status: string; auditId: string }> {
  return apiPost(
    `/api/billing/subscriptions/${encodeURIComponent(id)}/cancel`,
    req,
    { headers: idempotencyHeaders() },
  );
}

export function listAuditEvents(
  filters: AuditFilters,
  cursor: string | null,
): Promise<Page<AuditEventView>> {
  return apiGet<Page<AuditEventView>>(
    `/api/billing/audit${toQuery({
      actor: filters.actor ?? undefined,
      resource: filters.resource ?? undefined,
      correlationId: filters.correlationId ?? undefined,
      from: filters.from ?? undefined,
      to: filters.to ?? undefined,
      cursor: cursor ?? undefined,
    })}`,
  );
}

export function listAuditByCorrelation(correlationId: string): Promise<Page<AuditEventView>> {
  return listAuditEvents({ correlationId }, null);
}

/** Escopos de export CSV do billing (Fase 6 — stub até o Nest real assumir). */
export type BillingExportScope = "invoices" | "subscriptions" | "audit";

/**
 * Export CSV (exige `billing.manage`, mesma regra de cancel/refund:
 * confirmação + audit `billing.export` no backend).
 * TODO(backend pronto): gerar no Nest com filtros aplicados + audit.
 */
export async function exportBillingCsv(scope: BillingExportScope): Promise<{ filename: string; csv: string }> {
  const res = await fetch(`/api/billing/export?scope=${encodeURIComponent(scope)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Falha na exportação (${res.status}).`);
  }
  const csv = await res.text();
  return { filename: `billing-${scope}.csv`, csv };
}
