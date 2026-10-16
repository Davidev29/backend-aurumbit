import {
  MOCK_PRODUCTS,
  mockAuditPage,
  mockContracts,
  mockCustomerDetail,
  mockCustomerPage,
  mockDevices,
  mockFinanceFacets,
  mockInvoicePage,
  mockLicenses,
  mockSessions,
  mockSubscriptionPage,
} from "@/lib/mocks";
import type {
  AuditEventView,
  ContractView,
  CustomerDetail,
  CustomerSummary,
  DeviceView,
  InvoiceView,
  LicenseView,
  Page,
  SessionView,
  SubscriptionStatus,
  SubscriptionView,
} from "@/lib/types";

/**
 * Composição de dados do cliente p/ o modal/detalhe (Fase 2 — stubs).
 * TODO(backend pronto): trocar por `apiGet("/v1/customers/:id")` + sub-recursos
 * (`/v1/licenses?customer=`, `/v1/billing/invoices?customer=`, audit por
 * correlationId). Consumidores ignoram campos desconhecidos.
 */

export interface CustomerDevice extends DeviceView {
  licenseId: string;
}

export interface CustomerData {
  customer: CustomerDetail;
  contracts: ContractView[];
  licenses: LicenseView[];
  sessions: SessionView[];
  devices: CustomerDevice[];
  invoices: InvoiceView[];
  subscriptions: SubscriptionView[];
  /** Logs de auditoria vinculados (correlationIds das faturas + licenças). */
  audit: AuditEventView[];
}

/**
 * Registro em sessão dos pré-cadastros (stub robusto até o backend servir
 * `POST /v1/customers`). `getCustomerData` consulta aqui primeiro, então o
 * modal abre para clientes recém-criados sem divergência.
 */
const registeredCustomers = new Map<string, CustomerDetail>();

export function registerCustomer(customer: CustomerDetail): void {
  registeredCustomers.set(customer.id, customer);
}

/**
 * Overrides de bloqueio em sessão (fonte única p/ tabela + modal).
 * O backend real persiste `status`; aqui o `BlockCustomerDialog` escreve
 * neste mapa e ambas as superfícies leem via `getCustomerStatus`.
 */
const blockedOverrides = new Map<string, "active" | "blocked">();

export function getCustomerStatus(customerId: string): "active" | "blocked" {
  const override = blockedOverrides.get(customerId);
  if (override) return override;
  const base =
    registeredCustomers.get(customerId) ?? mockCustomerDetail(customerId);
  return base?.status ?? "active";
}

export function setCustomerBlocked(customerId: string, blocked: boolean): void {
  blockedOverrides.set(customerId, blocked ? "blocked" : "active");
}

/** Mascara CPF (11) / CNPJ (14) p/ exibição (LGPD — sem dígito além dos 2 finais). */
export function maskDoc(digits: string): string {
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`;
  return "••••";
}

function withEffectiveStatus(customer: CustomerDetail): CustomerDetail {
  const override = blockedOverrides.get(customer.id);
  if (!override || override === customer.status) return customer;
  return { ...customer, status: override };
}

/* ------------------------------------------------------------------ */
/* Trilhas de ação orquestradas (stub em sessão → backend real).        */
/* Cada ação gera 1 trilha primária + N secundárias ligadas pelo mesmo  */
/* `correlationId`, visíveis em Acessos > Logs. Mapa de efeitos:        */
/* - access: entitlement SUSPEND/RESUME (check nega em ~60s de cache);  */
/* - licensing: suspend espelha entitlements + invalida Redis;         */
/* - billing: SÓ suspend/cancel de subscription cessa cobrança futura  */
/*   (CANCEL é terminal — bloqueio usa SUSPEND reversível, nunca CANCEL);*/
/* - finance: sync invalida projeção; cortesia/bloqueio NÃO baixam     */
/*   recebíveis (só `mark-received` muta saldo — ADR-005);              */
/* - audit: append-only (primária + secundárias, nunca update/delete).  */
/* TODO(backend pronto): trocar `recordActionTrails` por endpoints      */
/* dedicados com `Idempotency-Key` por ação + mesmo `correlationId`:    */
/* `POST /v1/customers/:id/(block|unblock)`, `POST /v1/access/bonus` +  */
/* `finance.courtesy.hold`, `POST /v1/billing/invoices` (B7 CRIAR).      */
/* Custo stub: O(licenças + assinaturas), síncrono, sem rede.            */
/* ------------------------------------------------------------------ */

export interface TrailDraft {
  action: string;
  resource: string;
  resourceId: string;
  detail: string;
}

export interface RecordedTrail extends TrailDraft {
  id: string;
  correlationId: string;
  occurredAt: string;
}

const sessionTrails = new Map<string, RecordedTrail[]>();

/** Registra trilhas em sessão (acessórias — nunca quebram a ação). */
export function recordActionTrails(
  customerId: string,
  correlationId: string,
  entries: Array<TrailDraft & { id?: string }>,
): RecordedTrail[] {
  const stamp = Date.now();
  const recorded: RecordedTrail[] = entries.map((e, i) => ({
    ...e,
    id: e.id ?? `aud-trilha-${stamp}-${i}`,
    correlationId,
    occurredAt: new Date(stamp + i).toISOString(),
  }));
  sessionTrails.set(customerId, [...(sessionTrails.get(customerId) ?? []), ...recorded]);
  return recorded;
}

export function listSessionTrails(customerId: string): RecordedTrail[] {
  return sessionTrails.get(customerId) ?? [];
}

function activeSubscriptionsOf(data: CustomerData | null): CustomerData["subscriptions"] {
  if (!data) return [];
  return data.subscriptions.filter((s) => s.status === "ACTIVE" || s.status === "TRIAL" || s.status === "PAST_DUE");
}

/** Secundárias do BLOQUEIO (primária `customer.block` registrada pelo chamador). */
export function planBlockTrails(data: CustomerData | null, _correlationId: string): TrailDraft[] {
  if (!data) return [];
  void _correlationId;
  const drafts: TrailDraft[] = data.licenses
    .filter((l) => l.status === "active" || l.status === "grace")
    .map((l) => ({
      action: "entitlement.suspend",
      resource: "entitlement",
      resourceId: l.id,
      detail: `SUSPEND reversível — check passa a negar (${l.keyMasked} preservada, sem revogar).`,
    }));
  for (const s of activeSubscriptionsOf(data)) {
    drafts.push({
      action: "billing.subscription.suspend",
      resource: "subscription",
      resourceId: s.id,
      detail: `Pausa cobrança futura de ${s.planName} (SUSPEND reversível; CANCEL terminal nunca usado no bloqueio).`,
    });
  }
  drafts.push({
    action: "finance.projection.invalidate",
    resource: "projection",
    resourceId: data.customer.id,
    detail: "Projeção invalidada; recebíveis PENDENTES mantidos p/ decisão humana (sem baixa automática).",
  });
  return drafts;
}

/** Secundárias da LIBERAÇÃO (primária `customer.unblock` registrada pelo chamador). */
export function planUnblockTrails(data: CustomerData | null, _correlationId: string): TrailDraft[] {
  if (!data) return [];
  void _correlationId;
  const drafts: TrailDraft[] = data.licenses
    .filter((l) => l.status === "active" || l.status === "grace")
    .map((l) => ({
      action: "entitlement.resume",
      resource: "entitlement",
      resourceId: l.id,
      detail: `Retomada do acesso (${l.keyMasked}); expiração segue o avaliador (vitalício nunca expira).`,
    }));
  for (const s of activeSubscriptionsOf(data)) {
    drafts.push({
      action: "billing.subscription.resume",
      resource: "subscription",
      resourceId: s.id,
      detail: `Cobrança de ${s.planName} retoma; assinaturas CANCELADAS exigem nova assinatura (terminal).`,
    });
  }
  return drafts;
}

/** Secundárias do BÔNUS (primária é o `bonusId` do backend/BFF). */
export function planBonusTrails(
  data: CustomerData | null,
  licenseId: string,
  _correlationId: string,
): TrailDraft[] {
  void _correlationId;
  const lic = data?.licenses.find((l) => l.id === licenseId);
  const productName =
    (lic?.productId ? PRODUCT_CODE_TO_NAME.get(lic.productId) : null) ?? lic?.productId ?? licenseId;
  return [
    {
      action: "bonus.grant",
      resource: "bonus",
      resourceId: licenseId,
      detail: `Bônus em ${lic?.keyMasked ?? licenseId} (${productName}) — entitlement BONUS prioridade 5, sem outbox.`,
    },
    {
      action: "finance.courtesy.hold",
      resource: "receivable",
      resourceId: data?.customer.id ?? licenseId,
      detail: `Cortesia: recebíveis PENDENTES de ${productName} no período do bônus não cobrados (hold — nunca baixa saldo).`,
    },
  ];
}

/** Secundária do ajuste de máquinas (primária é a resposta do backend/BFF). */
export function planAdjustTrails(
  data: CustomerData | null,
  licenseId: string,
  delta: number,
  _correlationId: string,
): TrailDraft[] {
  void _correlationId;
  void data;
  return [
    {
      action: "device.link.allow",
      resource: "license",
      resourceId: licenseId,
      detail: `Limite ${delta > 0 ? "+" : ""}${delta} máquina(s) (enforcement FOR UPDATE no backend).`,
    },
  ];
}

/** Secundárias da cobrança avulsa (primária é o rascunho `inv-*`). */
export function planChargeTrails(
  data: CustomerData | null,
  chargeId: string,
  title: string,
  _correlationId: string,
): TrailDraft[] {
  void _correlationId;
  void data;
  return [
    {
      action: "billing.invoice.created",
      resource: "invoice",
      resourceId: chargeId,
      detail: `Fatura avulsa “${title}” (rascunho em sessão — backend: B7 CRIAR).`,
    },
    {
      action: "finance.receivable.forecast",
      resource: "receivable",
      resourceId: chargeId,
      detail: "Conta prevista (PREVISTO — nunca muta saldo; só `mark-received` baixa).",
    },
  ];
}

export function getCustomerData(customerId: string): CustomerData | null {
  const base =
    registeredCustomers.get(customerId) ?? mockCustomerDetail(customerId);
  if (!base) return null;
  const customer = withEffectiveStatus(base);
  const licenses = mockLicenses(customerId);
  const devices: CustomerDevice[] = licenses.flatMap((l) =>
    mockDevices(l.id).map((d) => ({ ...d, licenseId: l.id })),
  );
  // Faturas/assinaturas são globais no stub — filtra por cliente (página única ampla).
  const invoices = mockInvoicePage({}, null, 100).data.filter((i) => i.customerId === customerId);
  const subscriptions = mockSubscriptionPage(null, null, 100).data.filter(
    (s) => s.customerId === customerId,
  );
  const corrIds = new Set(invoices.map((i) => i.correlationId));
  const licenseIds = new Set(licenses.map((l) => l.id));
  const backendAudit = mockAuditPage({}, null, 200).data.filter(
    (e) => corrIds.has(e.correlationId) || (e.resource === "license" && licenseIds.has(e.resourceId)),
  );
  const sessionAudit: AuditEventView[] = listSessionTrails(customerId).map((t) => ({
    id: t.id,
    actor: "operador (sessão)",
    action: t.action,
    resource: t.resource,
    resourceId: t.resourceId,
    correlationId: t.correlationId,
    occurredAt: t.occurredAt,
    metadataMasked: { detalhe: t.detail, origem: "stub-sessão" },
  }));
  const audit = [...sessionAudit, ...backendAudit].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : -1,
  );
  return {
    customer,
    contracts: mockContracts(customerId),
    licenses,
    sessions: mockSessions(customerId),
    devices,
    invoices,
    subscriptions,
    audit,
  };
}

/* ------------------------------------------------------------------ */
/* Listagem com filtros + paginação por cursor (stub → backend real).   */
/* TODO(backend pronto): `GET /v1/customers?q=&product=&status=&cursor=` */
/* com `Page<CustomerSummary>` real; manter a mesma assinatura.         */
/* ------------------------------------------------------------------ */

export type CustomerStatusFilter = "all" | "active" | "blocked";

/** Linha enriquecida da tabela (produtos derivados de licenças/contratos). */
export interface CustomerRow extends CustomerDetail {
  /** Nomes de produto exibíveis (ex.: "Aurum Pro Mensal"). */
  products: string[];
}

export interface CustomerListParams {
  q?: string;
  product?: string | null;
  status?: CustomerStatusFilter;
  cursor?: string | null;
  limit?: number;
}

const PRODUCT_CODE_TO_NAME = new Map(
  MOCK_PRODUCTS.map((p) => [p.code, p.name]),
);

function productDisplayNameOfLicense(productId: string | undefined): string | null {
  if (!productId) return null;
  return PRODUCT_CODE_TO_NAME.get(productId) ?? productId;
}

/** Produtos do cliente (licenças + assinaturas + contratos), dedup + ordenado. */
export function getCustomerProducts(customerId: string): string[] {
  const data = getCustomerData(customerId);
  if (!data) return [];
  const names = new Set<string>();
  for (const l of data.licenses) {
    const n = productDisplayNameOfLicense(l.productId);
    if (n) names.add(n);
  }
  for (const s of data.subscriptions) {
    if (s.planName) names.add(s.planName);
  }
  for (const c of data.contracts) {
    if (c.productName) names.add(c.productName);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Opções do filtro por produto (catálogo + facetas financeiras + uso real). */
export function listCustomerProducts(): string[] {
  const names = new Set<string>();
  for (const p of MOCK_PRODUCTS) names.add(p.name);
  try {
    for (const p of mockFinanceFacets().products) names.add(p);
  } catch {
    /* facetas indisponíveis — catálogo basta */
  }
  // Inclui produtos de todos os clientes conhecidos (mocks + sessão).
  for (const c of allKnownCustomers()) {
    for (const n of getCustomerProducts(c.id)) names.add(n);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function allKnownCustomers(): CustomerDetail[] {
  const session = Array.from(registeredCustomers.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
  const base = mockCustomerPage("", null).data
    .map((s: CustomerSummary) => registeredCustomers.get(s.id) ?? mockCustomerDetail(s.id))
    .filter((c): c is CustomerDetail => !!c);
  const seen = new Set<string>();
  const merged: CustomerDetail[] = [];
  for (const c of [...session, ...base]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    merged.push(withEffectiveStatus(c));
  }
  return merged;
}

/** E-mails ocupados (lista + sessão), em minúsculas — p/ o pré-cadastro. */
export function listAllCustomerEmails(): string[] {
  return allKnownCustomers()
    .map((c) => c.email.toLowerCase())
    .filter(Boolean);
}

/**
 * Lista paginada por cursor (`cursor` = id do último item; `nextCursor`
 * null = fim). Filtra por nome/e-mail (`q`), produto e status; pré-cadastros
 * em sessão entram primeiro (mais recentes).
 */
export function listCustomers(params: CustomerListParams = {}): Page<CustomerRow> {
  const { q = "", product = null, status = "all", cursor = null, limit = 6 } = params;
  const needle = q.trim().toLowerCase();

  const filtered = allKnownCustomers().filter((c) => {
    if (status !== "all" && c.status !== status) return false;
    if (needle !== "") {
      const hay = `${c.name} ${c.email} ${c.id}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (product) {
      const products = getCustomerProducts(c.id);
      if (!products.includes(product)) return false;
    }
    return true;
  });

  const rows: CustomerRow[] = filtered.map((c) => ({
    ...c,
    products: getCustomerProducts(c.id),
  }));

  const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
  const from = Math.max(start, 0);
  const slice = rows.slice(from, from + Math.max(limit, 1));
  const last = slice[slice.length - 1];
  const hasMore =
    last !== undefined && rows.findIndex((r) => r.id === last.id) < rows.length - 1;
  return { data: slice, meta: { nextCursor: hasMore && last ? last.id : null, limit } };
}

/** Pacote escolhido a partir do nome do plano (Mensal/Anual). */export function planCycleOf(planName: string): "Mensal" | "Anual" | null {
  if (/mensal/i.test(planName)) return "Mensal";
  if (/anual/i.test(planName)) return "Anual";
  return null;
}

export type ContractState = "em-dia" | "atrasado" | "encerrado";

const SUBSCRIPTION_STATE: Record<SubscriptionStatus, { state: ContractState; label: string }> = {
  DRAFT: { state: "encerrado", label: "Rascunho" },
  ACTIVE: { state: "em-dia", label: "Em dia" },
  TRIAL: { state: "em-dia", label: "Em dia" },
  PAST_DUE: { state: "atrasado", label: "Atrasado" },
  SUSPENDED: { state: "encerrado", label: "Suspensa" },
  CANCELLED: { state: "encerrado", label: "Cancelada" },
  EXPIRED: { state: "encerrado", label: "Expirada" },
};

/** Estado da assinatura em pt-BR (texto + chave p/ tom do badge — nunca só cor). */
export function subscriptionState(s: SubscriptionView): { state: ContractState; label: string } {
  return SUBSCRIPTION_STATE[s.status];
}
