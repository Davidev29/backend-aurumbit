import { apiGet, apiPost } from "./api/client";
import type {
  AuditEventView,
  FinanceExportScope,
  FinanceFilters,
  FinanceSummary,
  InvoiceView,
  Page,
  PayableView,
  PaymentView,
  Period,
  ProjectionResponse,
  ReceivableView,
  SettleFinanceRequest,
  TransactionKind,
  TransactionView,
} from "./types";
import type { FinanceListFilters } from "./mocks";

// Re-exporta os filtros (fonte: `lib/mocks.ts`, espelho dos query DTOs do Nest).
export type { FinanceFilters, FinanceListFilters };

/**
 * Ações financeiras via BFF (`/api/finance/*` → Nest `/v1/finance/*` quando
 * `API_INTERNAL_URL` está configurado; stub em `lib/mocks.ts` senão).
 *
 * - Leitura exige `finance.read` explícito escopado por org (PROJECT §3,
 *   default deny p/ manager); backend nega 403.
 * - Pagar/baixar/export exigem `finance.manage` (só admin) + motivo >= 10 +
 *   confirmação na UI. POSTs sempre carregam `Idempotency-Key` (PROJECT §5).
 * - `Transaction` é o único mutador de saldo (REQUIREMENTS §3): pagar/baixar
 *   criam o lançamento realizado no backend via `assertTransition`.
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

function filtersToQuery(f: FinanceFilters): Record<string, string | null | undefined> {
  return {
    status: f.status ?? undefined,
    category: f.category ?? undefined,
    product: f.product ?? undefined,
    from: f.from ?? undefined,
    to: f.to ?? undefined,
  };
}

export function listPayables(
  filters: FinanceFilters,
  cursor: string | null,
): Promise<Page<PayableView>> {
  return apiGet<Page<PayableView>>(
    `/api/finance/payables${toQuery({ ...filtersToQuery(filters), cursor: cursor ?? undefined })}`,
  );
}

export function listReceivables(
  filters: FinanceFilters,
  cursor: string | null,
): Promise<Page<ReceivableView>> {
  return apiGet<Page<ReceivableView>>(
    `/api/finance/receivables${toQuery({ ...filtersToQuery(filters), cursor: cursor ?? undefined })}`,
  );
}

export function listTransactions(
  filters: FinanceFilters & { kind?: TransactionKind | null },
  cursor: string | null,
): Promise<Page<TransactionView>> {
  return apiGet<Page<TransactionView>>(
    `/api/finance/transactions${toQuery({
      ...filtersToQuery(filters),
      kind: filters.kind ?? undefined,
      cursor: cursor ?? undefined,
    })}`,
  );
}

export function getFinanceSummary(): Promise<FinanceSummary> {
  return apiGet<FinanceSummary>("/api/finance/summary");
}

export function getProjection(
  period: Period,
  category: string | null,
  product: string | null,
): Promise<ProjectionResponse> {
  return apiGet<ProjectionResponse>(
    `/api/finance/projection${toQuery({
      period,
      category: category ?? undefined,
      product: product ?? undefined,
    })}`,
  );
}

export function getFinanceFacets(): Promise<{ categories: string[]; products: string[] }> {
  return apiGet<{ categories: string[]; products: string[] }>("/api/finance/facets");
}

export interface FinanceTrace {
  invoice: InvoiceView | null;
  payments: PaymentView[];
  receivable: ReceivableView | null;
  payable: PayableView | null;
  transactions: TransactionView[];
  audit: AuditEventView[];
}

/** Cadeia charge → invoice → receivable/payable → transaction → audit. */
export function getFinanceTrace(
  params: { receivableId?: string; payableId?: string },
): Promise<FinanceTrace> {
  const qs = new URLSearchParams();
  if (params.receivableId) qs.set("receivableId", params.receivableId);
  if (params.payableId) qs.set("payableId", params.payableId);
  return apiGet<FinanceTrace>(`/api/finance/trace?${qs.toString()}`);
}

/** Pagar conta (exige `finance.manage`; motivo >= 10 + confirmação na UI). */
export function settlePayable(
  id: string,
  req: SettleFinanceRequest,
): Promise<{ transactionId: string; auditId: string; status: string }> {
  return apiPost(
    `/api/finance/payables/${encodeURIComponent(id)}/settle`,
    req,
    { headers: idempotencyHeaders() },
  );
}
/** Baixar conta a receber (exige `finance.manage`; motivo >= 10 + confirmação na UI). */
export function settleReceivable(
  id: string,
  req: SettleFinanceRequest,
): Promise<{ transactionId: string; auditId: string; status: string }> {
  return apiPost(
    `/api/finance/receivables/${encodeURIComponent(id)}/settle`,
    req,
    { headers: idempotencyHeaders() },
  );
}

/**
 * Export CSV (exige `finance.manage`, mesma regra de pagar/baixar).
 * TODO(backend pronto): gerar no Nest com 403 sem `finance.read`; hoje o BFF
 * retorna stub CSV a partir de `lib/mocks.ts`.
 */
export async function exportFinanceCsv(scope: FinanceExportScope): Promise<{ filename: string; csv: string }> {
  const res = await fetch(`/api/finance/export?scope=${encodeURIComponent(scope)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Falha na exportação (${res.status}).`);
  }
  const csv = await res.text();
  return { filename: `finance-${scope}.csv`, csv };
}

/* ------------------------------------------------------------------ */
/* Automação financeira (despesas via Asaas Bill Payments + receitas   */
/* automáticas + notificações in-system). POSTs sempre com             */
/* `Idempotency-Key` (PROJECT §5); replay retorna o existente.         */
/* ------------------------------------------------------------------ */

export interface CreateExpenseRequest {
  supplier: string;
  category_id?: string;
  account_id?: string;
  amount_cents: number;
  due_date: string;
  schedule_date?: string;
  barcode?: string;
  description?: string;
  pay_via_asaas?: boolean;
}

export type AutomationJobStatus = "QUEUED" | "SCHEDULED" | "RUNNING" | "DONE" | "FAILED" | "CANCELED";

export interface AutomationJobView {
  id: string;
  idempotencyKey: string;
  kind: "BILL_PAY" | "AUTO_CHARGE";
  payableId?: string | null;
  receivableId?: string | null;
  barcodeMasked?: string | null;
  scheduleDate?: string | null;
  provider: string;
  externalId?: string | null;
  status: AutomationJobStatus;
  attempts: number;
  lastError?: string | null;
}

export interface CreateExpenseResult {
  payable: { id: string; status: string; [k: string]: unknown };
  job: AutomationJobView | null;
  duplicate: boolean;
  viaAsaas: boolean;
}

export interface CreateAutoReceivableRequest {
  customer_name: string;
  asaas_customer_id: string;
  category_id?: string;
  amount_cents: number;
  due_date: string;
  billing_type?: "PIX" | "BOLETO" | "CREDIT_CARD" | "UNDEFINED";
  description?: string;
}

export interface CreateAutoReceivableResult {
  receivable: { id: string; status: string; [k: string]: unknown };
  job: AutomationJobView;
  duplicate: boolean;
  chargeId: string | null;
  identificationField: string | null;
}

export interface FinanceNotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  severity: "INFO" | "WARN" | "ERROR";
  read: boolean;
  createdAt: string;
}

/** Cria despesa (exige `finance.manage`); agenda/paga via Asaas quando suportado. */
export function createExpense(req: CreateExpenseRequest): Promise<CreateExpenseResult> {
  return apiPost<CreateExpenseResult>("/api/finance/expenses", req, { headers: idempotencyHeaders() });
}

/** Cria recebível com cobrança Asaas automática (exige `finance.manage`). */
export function createReceivableAuto(req: CreateAutoReceivableRequest): Promise<CreateAutoReceivableResult> {
  return apiPost<CreateAutoReceivableResult>("/api/finance/receivables/auto", req, {
    headers: idempotencyHeaders(),
  });
}

/** Estado da automação da despesa (job bill-pay). */
export function getExpenseAutomation(payableId: string): Promise<AutomationJobView | null> {
  return apiGet<AutomationJobView | null>(`/api/finance/expenses/${encodeURIComponent(payableId)}/automation`);
}

/** Notificações in-system (sino). */
export function listNotifications(unreadOnly = false): Promise<{ data: FinanceNotificationView[]; unread: number }> {
  return apiGet(`/api/finance/notifications${unreadOnly ? "?unread_only=true" : ""}`);
}

/** Marca notificação como lida (idempotente). */
export function markNotificationRead(id: string): Promise<FinanceNotificationView | null> {
  return apiPost(`/api/finance/notifications/${encodeURIComponent(id)}/read`, {});
}
