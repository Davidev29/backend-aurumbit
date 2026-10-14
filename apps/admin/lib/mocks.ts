import type {
  AdminUser,
  AuditEventView,
  ContractView,
  CreateProductRequest,
  CustomerDetail,
  CustomerSummary,
  DeviceView,
  FinanceSummary,
  InvoiceStatus,
  InvoiceView,
  IssueProductLicenseRequest,
  LicenseHistoryEntry,
  LicenseView,
  MeResponse,
  Organization,
  Page,
  PayableView,
  PaymentView,
  Period,
  PlanPriceChangeRequest,
  PlanPriceChangeResult,
  PlanView,
  ProductActiveClient,
  ProductImage,
  ProductStatus,
  ProductView,
  ProjectionPoint,
  ReceivableView,
  RenewReplaceRequest,
  SessionView,
  SubscriptionStatus,
  SubscriptionView,
  TransactionKind,
  TransactionView,
} from "./types";

/**
 * Mocks da Fase 2 — backend pode não estar pronto.
 * TODO(backend pronto): remover este módulo e buscar via `lib/api/client.ts`
 * nos endpoints `/v1/*` do Nest, com cursor pagination real.
 */

export const MOCK_ORGANIZATIONS: Organization[] = [
  { id: "org-acme", name: "Acme Ltda" },
  { id: "org-globex", name: "Globex S.A." },
];

/** Usuário admin com `finance.read` (concessão explícita — PROJECT §3) + licenças/bônus + billing. */
export const MOCK_ME_ADMIN: MeResponse = {
  id: "u-admin-1",
  email: "admin@aurum.test",
  name: "Ada Administradora",
  mfaRequired: true,
  mfaVerified: true,
  organizationId: "org-acme",
  // TODO(backend pronto): RBAC real — `product.manage` concedido só a admin/owner.
  permissions: ["customer.read", "user.read", "license.read", "license.adjust", "bonus.grant", "finance.read", "finance.manage", "billing.read", "billing.manage", "product.manage"],
};

/** Usuário manager COM `billing.read` (cobrança é operacional, manager+) mas SEM `billing.manage` nem `finance.read` (default deny — PROJECT §3). */
export const MOCK_ME_MANAGER: MeResponse = {
  id: "u-manager-1",
  email: "manager@aurum.test",
  name: "Mário Gerente",
  mfaRequired: false,
  mfaVerified: false,
  organizationId: "org-acme",
  permissions: ["customer.read", "user.read", "license.read", "billing.read"],
};

const CUSTOMERS: CustomerDetail[] = [
  {
    id: "cus-001",
    name: "Alice Alves",
    docMasked: "***.***.***-**",
    organizationId: "org-acme",
    status: "active",
    licensesCount: 2,
    email: "alice@example.com",
    createdAt: "2026-06-12T13:00:00.000Z",
  },
  {
    id: "cus-002",
    name: "Bruno Barros",
    docMasked: "***.***.***-**",
    organizationId: "org-acme",
    status: "active",
    licensesCount: 1,
    email: "bruno@example.com",
    createdAt: "2026-07-02T13:00:00.000Z",
  },
  {
    id: "cus-003",
    name: "Carla Costa",
    docMasked: "***.***.***-**",
    organizationId: "org-globex",
    status: "blocked",
    licensesCount: 0,
    email: "carla@example.com",
    createdAt: "2026-08-20T13:00:00.000Z",
  },
];

const LICENSES: Record<string, LicenseView[]> = {
  "cus-001": [
    {
      id: "lic-001",
      productId: "aurum-pro",
      keyMasked: "AURUM-••••-••••-AB12",
      keyPrefix: "AURU",
      keyLast4: "AB12",
      status: "active",
      startsAt: "2026-09-01T12:00:00.000Z",
      expiresAt: "2026-10-01T12:00:00.000Z",
      graceUntil: "2026-10-04T12:00:00.000Z",
      degraded: false,
      machinesUsed: 2,
      machinesAllowed: 3,
      origin: "SUBSCRIPTION",
      lastActivity: new Date(Date.now() - 60_000).toISOString(),
    },
    {
      id: "lic-002",
      productId: "aurum-pro",
      keyMasked: "AURUM-••••-••••-CD34",
      keyPrefix: "AURU",
      keyLast4: "CD34",
      status: "grace",
      startsAt: "2026-08-28T12:00:00.000Z",
      expiresAt: "2026-09-28T12:00:00.000Z",
      graceUntil: "2026-10-01T12:00:00.000Z",
      degraded: true,
      machinesUsed: 3,
      machinesAllowed: 3,
      origin: "LICENSE",
      lastActivity: new Date(Date.now() - 10 * 60_000).toISOString(),
    },
  ],
  "cus-002": [
    {
      id: "lic-003",
      productId: "aurum-base",
      keyMasked: "AURUM-••••-••••-EF56",
      keyPrefix: "AURU",
      keyLast4: "EF56",
      status: "active",
      startsAt: "2026-09-15T12:00:00.000Z",
      expiresAt: "2026-10-15T12:00:00.000Z",
      graceUntil: "2026-10-18T12:00:00.000Z",
      degraded: false,
      machinesUsed: 0,
      machinesAllowed: 1,
      origin: "CONTRACT",
      lastActivity: new Date(Date.now() - 60 * 60_000).toISOString(),
    },
  ],
};

const CONTRACTS: Record<string, ContractView[]> = {
  "cus-001": [
    {
      id: "ctr-001",
      productName: "Aurum Pro Mensal",
      priceFrozen: 149.9,
      currency: "BRL",
      startedAt: "2026-09-01T12:00:00.000Z",
    },
  ],
  "cus-002": [
    {
      id: "ctr-002",
      productName: "Aurum Base Anual",
      priceFrozen: 1199.0,
      currency: "BRL",
      startedAt: "2026-09-15T12:00:00.000Z",
    },
  ],
};

const SESSIONS: Record<string, SessionView[]> = {
  "cus-001": [
    {
      id: "ses-001",
      deviceLabel: "Windows · Chrome",
      lastActivity: new Date(Date.now() - 2 * 60_000).toISOString(),
      live: true,
      ipMasked: "192.168.1.0/24",
    },
    {
      id: "ses-002",
      deviceLabel: "Android · App",
      lastActivity: new Date(Date.now() - 6 * 60_000).toISOString(),
      live: false,
      ipMasked: "10.0.0.0/24",
    },
  ],
};

export const MOCK_USERS: AdminUser[] = [
  { id: "u-admin-1", name: "Ada Administradora", email: "admin@aurum.test", role: "OWNER", organizationId: "org-acme" },
  { id: "u-manager-1", name: "Mário Gerente", email: "manager@aurum.test", role: "ADMIN", organizationId: "org-acme" },
  { id: "u-fin-1", name: "Fiona Financeira", email: "finance@aurum.test", role: "FINANCE", organizationId: "org-acme" },
  { id: "u-member-1", name: "Membro Comum", email: "member@aurum.test", role: "MEMBER", organizationId: "org-globex" },
];

/** Acesso efetivo exibido na tabela stub (fonte real: backend Fase 2+). */
export const MOCK_EFFECTIVE_ACCESS: Record<string, string[]> = {
  // TODO(backend pronto): RBAC real — manager/member NÃO recebem `product.manage`.
  "u-admin-1": ["customer.read", "user.read", "license.read", "license.adjust", "bonus.grant", "finance.read", "finance.manage", "billing.read", "billing.manage", "product.manage"],
  "u-manager-1": ["customer.read", "user.read", "license.read", "billing.read"],
  "u-fin-1": ["finance.read", "billing.read"],
  "u-member-1": [],
};

export function mockCustomerPage(q: string, cursor: string | null): Page<CustomerSummary> {
  const filtered = CUSTOMERS.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  // Cursor stub: página única; `nextCursor` null indica fim (contrato Page).
  void cursor;
  return { data: filtered, meta: { nextCursor: null, limit: 20 } };
}

export function mockCustomerDetail(id: string): CustomerDetail | null {
  return CUSTOMERS.find((c) => c.id === id) ?? null;
}

export function mockLicenses(customerId: string): LicenseView[] {
  return LICENSES[customerId] ?? [];
}

export function mockContracts(customerId: string): ContractView[] {
  return CONTRACTS[customerId] ?? [];
}

export function mockSessions(customerId: string): SessionView[] {
  return SESSIONS[customerId] ?? [];
}

/**
 * Dispositivos por licença (Fase 3 stub).
 * `deviceHashMasked` é só prefixo+sufixo p/ suporte — nunca hardware cru (PROJECT §4).
 * TODO(backend pronto): `GET /v1/licenses/:id/devices`.
 */
const DEVICES: Record<string, DeviceView[]> = {
  "lic-001": [
    {
      id: "dev-001",
      licenseId: "lic-001",
      label: "Windows · Chrome",
      deviceHashMasked: "hmac:9f2c…AB12",
      lastActivity: new Date(Date.now() - 60_000).toISOString(),
      live: true,
    },
    {
      id: "dev-002",
      licenseId: "lic-001",
      label: "Android · App",
      deviceHashMasked: "hmac:71de…CD34",
      lastActivity: new Date(Date.now() - 6 * 60_000).toISOString(),
      live: false,
    },
  ],
  "lic-002": [
    {
      id: "dev-003",
      licenseId: "lic-002",
      label: "macOS · Safari",
      deviceHashMasked: "hmac:b44a…EF56",
      lastActivity: new Date(Date.now() - 10 * 60_000).toISOString(),
      live: false,
    },
    {
      id: "dev-004",
      licenseId: "lic-002",
      label: "Windows · App",
      deviceHashMasked: "hmac:02c9…GH78",
      lastActivity: new Date(Date.now() - 40 * 60_000).toISOString(),
      live: false,
      suspectClone: true,
    },
  ],
  "lic-003": [],
};

export function mockDevices(licenseId: string): DeviceView[] {
  return DEVICES[licenseId] ?? [];
}

/** Busca licença por id em todos os clientes (stub p/ rotas BFF Fase 3). */
export function mockLicenseById(id: string): LicenseView | null {
  for (const list of Object.values(LICENSES)) {
    const found = list.find((l) => l.id === id);
    if (found) return found;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Fase 4 — Billing stubs (espelham Nest `/v1/billing/*` + Asaas       */
/* sandbox). Sem financeiro realizado (Fase 5).                        */
/* TODO(backend pronto): remover e buscar via BFF `app/api/billing/*`. */
/* ------------------------------------------------------------------ */

const INVOICES: InvoiceView[] = [
  {
    id: "inv-001",
    customerId: "cus-001",
    customerName: "Alice Alves",
    amount: 149.9,
    currency: "BRL",
    status: "PAID",
    dueDate: "2026-09-10T12:00:00.000Z",
    paidAt: "2026-09-09T15:30:00.000Z",
    externalId: "chg_asaas_001",
    provider: "ASAAS",
    correlationId: "corr-inv-001",
    createdAt: "2026-09-01T12:00:00.000Z",
  },
  {
    id: "inv-002",
    customerId: "cus-001",
    customerName: "Alice Alves",
    amount: 149.9,
    currency: "BRL",
    status: "OVERDUE",
    dueDate: "2026-10-05T12:00:00.000Z",
    paidAt: null,
    externalId: "chg_asaas_002",
    provider: "ASAAS",
    correlationId: "corr-inv-002",
    createdAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "inv-003",
    customerId: "cus-002",
    customerName: "Bruno Barros",
    amount: 1199.0,
    currency: "BRL",
    status: "PENDING",
    dueDate: "2026-10-15T12:00:00.000Z",
    paidAt: null,
    externalId: "chg_asaas_003",
    provider: "ASAAS",
    correlationId: "corr-inv-003",
    createdAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "inv-004",
    customerId: "cus-002",
    customerName: "Bruno Barros",
    amount: 1199.0,
    currency: "BRL",
    status: "REFUNDED",
    dueDate: "2026-09-15T12:00:00.000Z",
    paidAt: "2026-09-14T10:00:00.000Z",
    externalId: "chg_asaas_004",
    provider: "ASAAS",
    correlationId: "corr-inv-004",
    createdAt: "2026-09-01T12:00:00.000Z",
  },
  {
    id: "inv-005",
    customerId: "cus-003",
    customerName: "Carla Costa",
    amount: 149.9,
    currency: "BRL",
    status: "PENDING",
    dueDate: "2026-10-20T12:00:00.000Z",
    paidAt: null,
    externalId: "chg_asaas_005",
    provider: "ASAAS",
    correlationId: "corr-inv-005",
    createdAt: "2026-10-05T12:00:00.000Z",
  },
  {
    id: "inv-006",
    customerId: "cus-001",
    customerName: "Alice Alves",
    amount: 149.9,
    currency: "BRL",
    status: "CANCELLED",
    dueDate: "2026-08-10T12:00:00.000Z",
    paidAt: null,
    externalId: "chg_asaas_006",
    provider: "ASAAS",
    correlationId: "corr-inv-006",
    createdAt: "2026-08-01T12:00:00.000Z",
  },
];

const PAYMENTS: Record<string, PaymentView[]> = {
  "inv-001": [
    {
      id: "pay-001",
      invoiceId: "inv-001",
      externalId: "pay_asaas_001",
      amount: 149.9,
      currency: "BRL",
      status: "CONFIRMED",
      method: "PIX",
      paidAt: "2026-09-09T15:30:00.000Z",
      correlationId: "corr-inv-001",
      createdAt: "2026-09-09T15:30:00.000Z",
    },
  ],
  "inv-002": [],
  "inv-003": [
    {
      id: "pay-003",
      invoiceId: "inv-003",
      externalId: "pay_asaas_003",
      amount: 1199.0,
      currency: "BRL",
      status: "PENDING",
      method: "BOLETO",
      paidAt: null,
      correlationId: "corr-inv-003",
      createdAt: "2026-10-01T12:00:00.000Z",
    },
  ],
  "inv-004": [
    {
      id: "pay-004",
      invoiceId: "inv-004",
      externalId: "pay_asaas_004",
      amount: 1199.0,
      currency: "BRL",
      status: "REFUNDED",
      method: "CREDIT_CARD",
      paidAt: "2026-09-14T10:00:00.000Z",
      correlationId: "corr-inv-004",
      createdAt: "2026-09-14T10:00:00.000Z",
    },
  ],
  "inv-005": [],
  "inv-006": [],
};

const SUBSCRIPTIONS: SubscriptionView[] = [
  {
    id: "sub-001",
    customerId: "cus-001",
    customerName: "Alice Alves",
    planName: "Aurum Pro Mensal",
    status: "ACTIVE",
    amount: 149.9,
    currency: "BRL",
    nextDue: "2026-11-05T12:00:00.000Z",
    externalId: "sub_asaas_001",
    correlationId: "corr-sub-001",
    createdAt: "2026-09-01T12:00:00.000Z",
  },
  {
    id: "sub-002",
    customerId: "cus-002",
    customerName: "Bruno Barros",
    planName: "Aurum Base Anual",
    status: "PAST_DUE",
    amount: 1199.0,
    currency: "BRL",
    nextDue: "2026-10-12T12:00:00.000Z",
    externalId: "sub_asaas_002",
    correlationId: "corr-sub-002",
    createdAt: "2026-09-15T12:00:00.000Z",
  },
  {
    id: "sub-003",
    customerId: "cus-003",
    customerName: "Carla Costa",
    planName: "Aurum Pro Mensal",
    status: "TRIAL",
    amount: 149.9,
    currency: "BRL",
    nextDue: "2026-10-18T12:00:00.000Z",
    externalId: "sub_asaas_003",
    correlationId: "corr-sub-003",
    createdAt: "2026-10-04T12:00:00.000Z",
  },
  {
    id: "sub-004",
    customerId: "cus-002",
    customerName: "Bruno Barros",
    planName: "Aurum Pro Mensal",
    status: "CANCELLED",
    amount: 149.9,
    currency: "BRL",
    nextDue: "2026-09-15T12:00:00.000Z",
    externalId: "sub_asaas_004",
    correlationId: "corr-sub-004",
    createdAt: "2026-08-15T12:00:00.000Z",
    cancelledAt: "2026-09-10T12:00:00.000Z",
  },
];

const AUDIT_EVENTS: AuditEventView[] = [
  {
    id: "aud-001",
    actor: "system:webhook",
    action: "payment.confirmed",
    resource: "payment",
    resourceId: "pay-001",
    correlationId: "corr-inv-001",
    occurredAt: "2026-09-09T15:30:01.000Z",
    metadataMasked: { invoiceId: "inv-001", externalId: "pay_asaas_001", amount: 149.9, method: "PIX" },
  },
  {
    id: "aud-002",
    actor: "system:recon",
    action: "invoice.overdue",
    resource: "invoice",
    resourceId: "inv-002",
    correlationId: "corr-inv-002",
    occurredAt: "2026-10-06T03:00:10.000Z",
    metadataMasked: { invoiceId: "inv-002", externalId: "chg_asaas_002", source: "RECONCILIATION" },
  },
  {
    id: "aud-003",
    actor: "admin@aurum.test",
    action: "subscription.cancel",
    resource: "subscription",
    resourceId: "sub-004",
    correlationId: "corr-sub-004",
    occurredAt: "2026-09-10T12:00:05.000Z",
    metadataMasked: { subscriptionId: "sub-004", motivo: "Solicitação do cliente via suporte" },
  },
  {
    id: "aud-004",
    actor: "admin@aurum.test",
    action: "invoice.refund",
    resource: "invoice",
    resourceId: "inv-004",
    correlationId: "corr-inv-004",
    occurredAt: "2026-09-16T09:12:00.000Z",
    metadataMasked: { invoiceId: "inv-004", externalId: "chg_asaas_004", motivo: "Cobrança em duplicidade confirmada" },
  },
  {
    id: "aud-005",
    actor: "system:webhook",
    action: "payment.received",
    resource: "payment",
    resourceId: "pay-003",
    correlationId: "corr-inv-003",
    occurredAt: "2026-10-01T12:00:02.000Z",
    metadataMasked: { invoiceId: "inv-003", externalId: "pay_asaas_003", method: "BOLETO" },
  },
  {
    id: "aud-006",
    actor: "manager@aurum.test",
    action: "invoice.view",
    resource: "invoice",
    resourceId: "inv-001",
    correlationId: "corr-inv-001",
    occurredAt: "2026-10-08T14:20:00.000Z",
    metadataMasked: { invoiceId: "inv-001" },
  },
  {
    id: "aud-007",
    actor: "system:webhook",
    action: "subscription.past_due",
    resource: "subscription",
    resourceId: "sub-002",
    correlationId: "corr-sub-002",
    occurredAt: "2026-10-11T08:00:00.000Z",
    metadataMasked: { subscriptionId: "sub-002", externalId: "sub_asaas_002" },
  },
  {
    id: "aud-008",
    actor: "admin@aurum.test",
    action: "license.reveal",
    resource: "license",
    resourceId: "lic-001",
    correlationId: "corr-lic-001",
    occurredAt: "2026-10-09T11:00:00.000Z",
    metadataMasked: { licenseId: "lic-001", motivo: "Suporte: reinstalação do cliente" },
  },
  // Fase 5 — eventos financeiros (elo receivable/transaction → audit).
  {
    id: "aud-fin-001",
    actor: "admin@aurum.test",
    action: "payable.settle",
    resource: "payable",
    resourceId: "ap-003",
    correlationId: "corr-fin-ap-003",
    occurredAt: "2026-09-09T14:00:02.000Z",
    metadataMasked: { payableId: "ap-003", amount: 1500.0, transactionId: "txn-002" },
  },
  {
    id: "aud-fin-002",
    actor: "admin@aurum.test",
    action: "receivable.settle",
    resource: "receivable",
    resourceId: "ar-003",
    correlationId: "corr-inv-001",
    occurredAt: "2026-09-09T15:30:02.000Z",
    metadataMasked: { receivableId: "ar-003", amount: 1199.0, transactionId: "txn-001" },
  },
  {
    id: "aud-fin-003",
    actor: "system:recon",
    action: "transaction.created",
    resource: "transaction",
    resourceId: "txn-005",
    correlationId: "corr-inv-003",
    occurredAt: "2026-10-08T11:00:02.000Z",
    metadataMasked: { transactionId: "txn-005", sourceId: "ar-001", amount: 149.9 },
  },
];

export interface InvoiceFilters {
  status?: InvoiceStatus | null;
  dueFrom?: string | null;
  dueTo?: string | null;
}

/** Pagina faturas por cursor (`cursor` = id do último item; `nextCursor` null = fim). */
export function mockInvoicePage(filters: InvoiceFilters, cursor: string | null, limit = 20): Page<InvoiceView> {
  const filtered = INVOICES.filter((inv) => {
    if (filters.status && inv.status !== filters.status) return false;
    if (filters.dueFrom && inv.dueDate < filters.dueFrom) return false;
    if (filters.dueTo && inv.dueDate > filters.dueTo) return false;
    return true;
  });
  const start = cursor ? filtered.findIndex((i) => i.id === cursor) + 1 : 0;
  const from = Math.max(start, 0);
  const slice = filtered.slice(from, from + limit);
  const last = slice[slice.length - 1];
  const hasMore = last !== undefined && filtered.findIndex((i) => i.id === last.id) < filtered.length - 1;
  return { data: slice, meta: { nextCursor: hasMore && last ? last.id : null, limit } };
}

export function mockInvoiceById(id: string): InvoiceView | null {
  return INVOICES.find((i) => i.id === id) ?? null;
}

export function mockPaymentsByInvoice(invoiceId: string): PaymentView[] {
  return PAYMENTS[invoiceId] ?? [];
}

export function mockSubscriptionPage(status: SubscriptionStatus | null, cursor: string | null, limit = 20): Page<SubscriptionView> {
  const filtered = status ? SUBSCRIPTIONS.filter((s) => s.status === status) : [...SUBSCRIPTIONS];
  const start = cursor ? filtered.findIndex((s) => s.id === cursor) + 1 : 0;
  const from = Math.max(start, 0);
  const slice = filtered.slice(from, from + limit);
  const last = slice[slice.length - 1];
  const hasMore = last !== undefined && filtered.findIndex((s) => s.id === last.id) < filtered.length - 1;
  return { data: slice, meta: { nextCursor: hasMore && last ? last.id : null, limit } };
}

export function mockSubscriptionById(id: string): SubscriptionView | null {
  return SUBSCRIPTIONS.find((s) => s.id === id) ?? null;
}

export interface AuditFilters {
  actor?: string | null;
  resource?: string | null;
  correlationId?: string | null;
  from?: string | null;
  to?: string | null;
}

export function mockAuditPage(filters: AuditFilters, cursor: string | null, limit = 20): Page<AuditEventView> {
  const filtered = AUDIT_EVENTS.filter((e) => {
    if (filters.actor && !e.actor.toLowerCase().includes(filters.actor.toLowerCase())) return false;
    if (filters.resource && e.resource !== filters.resource) return false;
    if (filters.correlationId && !e.correlationId.toLowerCase().includes(filters.correlationId.toLowerCase())) return false;
    if (filters.from && e.occurredAt < filters.from) return false;
    if (filters.to && e.occurredAt > filters.to) return false;
    return true;
  }).sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  const start = cursor ? filtered.findIndex((e) => e.id === cursor) + 1 : 0;
  const from = Math.max(start, 0);
  const slice = filtered.slice(from, from + limit);
  const last = slice[slice.length - 1];
  const hasMore = last !== undefined && filtered.findIndex((e) => e.id === last.id) < filtered.length - 1;
  return { data: slice, meta: { nextCursor: hasMore && last ? last.id : null, limit } };
}

export function mockAuditByCorrelation(correlationId: string): AuditEventView[] {
  return AUDIT_EVENTS.filter((e) => e.correlationId === correlationId);
}

/* ------------------------------------------------------------------ */
/* Fase 5 — Finance stubs (espelham Nest `/v1/finance/*`). Previsto    */
/* (`payables`/`receivables`), realizado (`transactions`, único       */
/* mutador de saldo) e projeção receita×despesa.                        */
/* TODO(backend pronto): remover e buscar via BFF `app/api/finance/*`. */
/* ------------------------------------------------------------------ */

const PAYABLES: PayableView[] = [
  {
    id: "ap-001",
    supplier: "Nuvem Hospedagem Ltda",
    category: "Infraestrutura",
    product: "Aurum Pro Mensal",
    amount: 2490.0,
    currency: "BRL",
    status: "PENDENTE",
    dueDate: "2026-10-12T12:00:00.000Z",
    paidAt: null,
    recurrence: "MENSAL",
    correlationId: "corr-fin-ap-001",
    createdAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "ap-002",
    supplier: "Resend Serviços",
    category: "Comunicação",
    product: "Aurum Base Anual",
    amount: 899.9,
    currency: "BRL",
    status: "PREVISTO",
    dueDate: "2026-10-25T12:00:00.000Z",
    paidAt: null,
    recurrence: "MENSAL",
    correlationId: "corr-fin-ap-002",
    createdAt: "2026-10-03T12:00:00.000Z",
  },
  {
    id: "ap-003",
    supplier: "Escritório Contábil Prisma",
    category: "Administrativo",
    product: "Aurum Pro Mensal",
    amount: 1500.0,
    currency: "BRL",
    status: "PAGO",
    dueDate: "2026-09-10T12:00:00.000Z",
    paidAt: "2026-09-09T14:00:00.000Z",
    recurrence: "MENSAL",
    correlationId: "corr-fin-ap-003",
    createdAt: "2026-09-01T12:00:00.000Z",
  },
  {
    id: "ap-004",
    supplier: "DataCenter Energia S.A.",
    category: "Infraestrutura",
    product: "Aurum Base Anual",
    amount: 3200.0,
    currency: "BRL",
    status: "VENCIDO",
    dueDate: "2026-09-28T12:00:00.000Z",
    paidAt: null,
    recurrence: "UNICA",
    correlationId: "corr-fin-ap-004",
    createdAt: "2026-09-20T12:00:00.000Z",
  },
  {
    id: "ap-005",
    supplier: "Agência Marca & Cia",
    category: "Marketing",
    product: "Aurum Pro Mensal",
    amount: 4500.0,
    currency: "BRL",
    status: "PREVISTO",
    dueDate: "2026-11-05T12:00:00.000Z",
    paidAt: null,
    recurrence: "TRIMESTRAL",
    correlationId: "corr-fin-ap-005",
    createdAt: "2026-10-05T12:00:00.000Z",
  },
];

const RECEIVABLES: ReceivableView[] = [
  {
    id: "ar-001",
    customerId: "cus-001",
    customerName: "Alice Alves",
    category: "Assinatura",
    product: "Aurum Pro Mensal",
    amount: 149.9,
    currency: "BRL",
    status: "PENDENTE",
    dueDate: "2026-10-15T12:00:00.000Z",
    receivedAt: null,
    recurrence: "MENSAL",
    invoiceId: "inv-003",
    correlationId: "corr-inv-003",
    createdAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "ar-002",
    customerId: "cus-001",
    customerName: "Alice Alves",
    category: "Assinatura",
    product: "Aurum Pro Mensal",
    amount: 149.9,
    currency: "BRL",
    status: "VENCIDO",
    dueDate: "2026-10-05T12:00:00.000Z",
    receivedAt: null,
    recurrence: "MENSAL",
    invoiceId: "inv-002",
    correlationId: "corr-inv-002",
    createdAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "ar-003",
    customerId: "cus-002",
    customerName: "Bruno Barros",
    category: "Assinatura",
    product: "Aurum Base Anual",
    amount: 1199.0,
    currency: "BRL",
    status: "RECEBIDO",
    dueDate: "2026-09-10T12:00:00.000Z",
    receivedAt: "2026-09-09T15:30:00.000Z",
    recurrence: "ANUAL",
    invoiceId: "inv-001",
    correlationId: "corr-inv-001",
    createdAt: "2026-09-01T12:00:00.000Z",
  },
  {
    id: "ar-004",
    customerId: "cus-003",
    customerName: "Carla Costa",
    category: "Assinatura",
    product: "Aurum Pro Mensal",
    amount: 149.9,
    currency: "BRL",
    status: "PREVISTO",
    dueDate: "2026-10-20T12:00:00.000Z",
    receivedAt: null,
    recurrence: "MENSAL",
    invoiceId: "inv-005",
    correlationId: "corr-inv-005",
    createdAt: "2026-10-05T12:00:00.000Z",
  },
  {
    id: "ar-005",
    customerId: "cus-002",
    customerName: "Bruno Barros",
    category: "Assinatura",
    product: "Aurum Base Anual",
    amount: 1199.0,
    currency: "BRL",
    status: "PREVISTO",
    dueDate: "2026-11-15T12:00:00.000Z",
    receivedAt: null,
    recurrence: "ANUAL",
    invoiceId: null,
    correlationId: "corr-fin-ar-005",
    createdAt: "2026-10-06T12:00:00.000Z",
  },
];

const TRANSACTIONS: TransactionView[] = [
  {
    id: "txn-001",
    kind: "RECEITA",
    description: "Recebimento Alice Alves — fatura inv-001",
    category: "Assinatura",
    product: "Aurum Pro Mensal",
    amount: 149.9,
    currency: "BRL",
    settledAt: "2026-09-09T15:30:00.000Z",
    sourceId: "ar-003",
    sourceKind: "receivable",
    correlationId: "corr-inv-001",
    createdAt: "2026-09-09T15:30:01.000Z",
  },
  {
    id: "txn-002",
    kind: "DESPESA",
    description: "Pagamento Escritório Contábil Prisma",
    category: "Administrativo",
    product: "Aurum Pro Mensal",
    amount: 1500.0,
    currency: "BRL",
    settledAt: "2026-09-09T14:00:00.000Z",
    sourceId: "ap-003",
    sourceKind: "payable",
    correlationId: "corr-fin-ap-003",
    createdAt: "2026-09-09T14:00:01.000Z",
  },
  {
    id: "txn-003",
    kind: "RECEITA",
    description: "Recebimento Bruno Barros — anual",
    category: "Assinatura",
    product: "Aurum Base Anual",
    amount: 1199.0,
    currency: "BRL",
    settledAt: "2026-09-14T10:00:00.000Z",
    sourceId: "ar-003",
    sourceKind: "receivable",
    correlationId: "corr-inv-004",
    createdAt: "2026-09-14T10:00:01.000Z",
  },
  {
    id: "txn-004",
    kind: "DESPESA",
    description: "Pagamento Nuvem Hospedagem — set/26",
    category: "Infraestrutura",
    product: "Aurum Pro Mensal",
    amount: 2490.0,
    currency: "BRL",
    settledAt: "2026-09-12T10:00:00.000Z",
    sourceId: "ap-001",
    sourceKind: "payable",
    correlationId: "corr-fin-ap-001",
    createdAt: "2026-09-12T10:00:01.000Z",
  },
  {
    id: "txn-005",
    kind: "RECEITA",
    description: "Recebimento Alice Alves — out/26",
    category: "Assinatura",
    product: "Aurum Pro Mensal",
    amount: 149.9,
    currency: "BRL",
    settledAt: "2026-10-08T11:00:00.000Z",
    sourceId: "ar-001",
    sourceKind: "receivable",
    correlationId: "corr-inv-003",
    createdAt: "2026-10-08T11:00:01.000Z",
  },
];

export interface FinanceListFilters {
  status?: string | null;
  category?: string | null;
  product?: string | null;
  from?: string | null;
  to?: string | null;
}

function applyFinanceFilters<T extends { dueDate?: string; settledAt?: string; category: string; product?: string; status?: string }>(
  rows: T[],
  filters: FinanceListFilters,
  dateOf: (r: T) => string,
): T[] {
  return rows.filter((r) => {
    if (filters.status && r.status !== filters.status) return false;
    if (filters.category && r.category !== filters.category) return false;
    if (filters.product && r.product !== filters.product) return false;
    const d = dateOf(r);
    if (filters.from && d < filters.from) return false;
    if (filters.to && d > filters.to) return false;
    return true;
  });
}

function paginate<T extends { id: string }>(rows: T[], cursor: string | null, limit: number): Page<T> {
  const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
  const from = Math.max(start, 0);
  const slice = rows.slice(from, from + limit);
  const last = slice[slice.length - 1];
  const hasMore = last !== undefined && rows.findIndex((r) => r.id === last.id) < rows.length - 1;
  return { data: slice, meta: { nextCursor: hasMore && last ? last.id : null, limit } };
}

/** Contas a pagar por cursor (colunas: fornecedor/categoria/vencimento/estado/recorrência). */
export function mockPayablePage(filters: FinanceListFilters, cursor: string | null, limit = 20): Page<PayableView> {
  return paginate(
    applyFinanceFilters(PAYABLES, filters, (r) => r.dueDate).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)),
    cursor,
    limit,
  );
}

/** Contas a receber por cursor. */
export function mockReceivablePage(filters: FinanceListFilters, cursor: string | null, limit = 20): Page<ReceivableView> {
  return paginate(
    applyFinanceFilters(RECEIVABLES, filters, (r) => r.dueDate).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)),
    cursor,
    limit,
  );
}

/** Extrato realizado por cursor (mais recente primeiro). */
export function mockTransactionPage(
  filters: FinanceListFilters & { kind?: TransactionKind | null },
  cursor: string | null,
  limit = 20,
): Page<TransactionView> {
  const rows = applyFinanceFilters(
    TRANSACTIONS.filter((t) => (!filters.kind || t.kind === filters.kind) && (!filters.status || t.kind === filters.status)),
    { ...filters, status: null },
    (r) => r.settledAt,
  ).sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1));
  return paginate(rows, cursor, limit);
}

export function mockPayableById(id: string): PayableView | null {
  return PAYABLES.find((p) => p.id === id) ?? null;
}

export function mockReceivableById(id: string): ReceivableView | null {
  return RECEIVABLES.find((r) => r.id === id) ?? null;
}

export function mockReceivableByInvoice(invoiceId: string): ReceivableView | null {
  return RECEIVABLES.find((r) => r.invoiceId === invoiceId) ?? null;
}

export function mockTransactionsBySource(sourceId: string): TransactionView[] {
  return TRANSACTIONS.filter((t) => t.sourceId === sourceId);
}

/** KPIs previsto/pendente/realizado + inadimplência (Fase 5). */
export function mockFinanceSummary(): FinanceSummary {
  const prev = (ns: Array<{ status: string; amount: number }>, statuses: string[]): number =>
    ns.filter((r) => statuses.includes(r.status)).reduce((s, r) => s + r.amount, 0);
  const previsto = prev(PAYABLES, ["PREVISTO", "PENDENTE", "VENCIDO"]) + prev(RECEIVABLES, ["PREVISTO", "PENDENTE", "VENCIDO"]);
  const pendente =
    prev(PAYABLES, ["PENDENTE", "VENCIDO"]) + prev(RECEIVABLES, ["PENDENTE", "VENCIDO"]);
  const realizado = TRANSACTIONS.reduce((s, t) => s + (t.kind === "RECEITA" ? t.amount : -t.amount), 0);
  const aReceber = RECEIVABLES.filter((r) => ["PREVISTO", "PENDENTE", "VENCIDO"].includes(r.status)).reduce(
    (s, r) => s + r.amount,
    0,
  );
  const inadimplente = prev(RECEIVABLES, ["VENCIDO"]);
  return {
    previsto: round2(previsto),
    pendente: round2(pendente),
    realizado: round2(realizado),
    inadimplente: round2(inadimplente),
    taxaInadimplencia: aReceber > 0 ? round2(inadimplente / (aReceber + prev(RECEIVABLES, ["RECEBIDO"]))) : 0,
    currency: "BRL",
    // Stub sem reconciliação Asaas/hourly — snapshot pode estar desatualizado.
    isStale: true,
    staleReason: "Snapshot de demonstração — reconciliação Asaas pendente (stub Fase 5).",
    asOf: new Date().toISOString(),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Projeção receita×despesa por período (agrega realizado + previsto). */
export function mockProjection(
  period: Period,
  category: string | null,
  product: string | null,
): { points: ProjectionPoint[]; isStale: boolean; staleReason?: string; asOf: string } {
  const match = (c: string, p?: string): boolean =>
    (!category || c === category) && (!product || p === product);
  const buckets = new Map<string, { receita: number; despesa: number }>();

  const bucketOf = (iso: string): string => {
    const d = new Date(iso);
    if (period === "year") return `${d.getUTCFullYear()}`;
    if (period === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    // week: segunda-feira da semana (UTC) como rótulo.
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dow = (monday.getUTCDay() + 6) % 7;
    monday.setUTCDate(monday.getUTCDate() - dow);
    return monday.toISOString().slice(0, 10);
  };

  const add = (iso: string, receita: number, despesa: number): void => {
    const b = bucketOf(iso);
    const cur = buckets.get(b) ?? { receita: 0, despesa: 0 };
    cur.receita += receita;
    cur.despesa += despesa;
    buckets.set(b, cur);
  };

  for (const t of TRANSACTIONS) {
    if (!match(t.category, t.product)) continue;
    add(t.settledAt, t.kind === "RECEITA" ? t.amount : 0, t.kind === "DESPESA" ? t.amount : 0);
  }
  for (const r of RECEIVABLES) {
    if (["RECEBIDO", "CANCELADO"].includes(r.status)) continue;
    if (!match(r.category, r.product)) continue;
    add(r.dueDate, r.amount, 0);
  }
  for (const p of PAYABLES) {
    if (["PAGO", "CANCELADO"].includes(p.status)) continue;
    if (!match(p.category, p.product)) continue;
    add(p.dueDate, 0, p.amount);
  }

  const points: ProjectionPoint[] = Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-12)
    .map(([bucket, v]) => ({ bucket, receita: round2(v.receita), despesa: round2(v.despesa) }));

  return {
    points,
    isStale: true,
    staleReason: "Projeção de demonstração — snapshot sem hash do backend (stub Fase 5).",
    asOf: new Date().toISOString(),
  };
}

/** Categorias/produtos distintos p/ filtros da projeção. */
export function mockFinanceFacets(): { categories: string[]; products: string[] } {
  const categories = new Set<string>();
  const products = new Set<string>();
  for (const r of [...PAYABLES, ...RECEIVABLES, ...TRANSACTIONS]) {
    categories.add(r.category);
    if (r.product) products.add(r.product);
  }
  return { categories: Array.from(categories).sort(), products: Array.from(products).sort() };
}

/** CSV stub do extrato (TODO backend: gerar no Nest com 403 `finance.read`). */
export function mockFinanceCsv(scope: "payables" | "receivables" | "transactions"): string {
  const header = "id;descricao;categoria;valor;moeda;estado;data\n";
  const line = (cells: Array<string | number>): string =>
    cells.map((c) => String(c).replace(/;/g, ",")).join(";") + "\n";
  if (scope === "payables") {
    return header + PAYABLES.map((p) => line([p.id, p.supplier, p.category, p.amount, p.currency, p.status, p.dueDate])).join("");
  }
  if (scope === "receivables") {
    return header + RECEIVABLES.map((r) => line([r.id, r.customerName, r.category, r.amount, r.currency, r.status, r.dueDate])).join("");
  }
  return header + TRANSACTIONS.map((t) => line([t.id, t.description, t.category, t.amount, t.currency, t.kind, t.settledAt])).join("");
}

/* ------------------------------------------------------------------ */
/* Fase 6 — Billing export + Filas/DLQ stubs (espelham Nest real).     */
/* TODO(backend pronto Fase 6): remover e buscar via BFF.              */
/* ------------------------------------------------------------------ */

/** CSV stub do billing (sem PII além do já mascarado — nomes + ids). */
export function mockBillingCsv(scope: "invoices" | "subscriptions" | "audit"): string {
  const line = (cells: Array<string | number | null>): string =>
    cells.map((c) => (c === null ? "" : String(c).replace(/;/g, ","))).join(";") + "\n";
  if (scope === "invoices") {
    return (
      "id;cliente;valor;moeda;estado;vencimento;charge;correlationId\n" +
      INVOICES.map((i) =>
        line([i.id, i.customerName, i.amount, i.currency, i.status, i.dueDate, i.externalId, i.correlationId]),
      ).join("")
    );
  }
  if (scope === "subscriptions") {
    return (
      "id;cliente;plano;estado;valor;moeda;proxima_cobranca;correlationId\n" +
      SUBSCRIPTIONS.map((s) =>
        line([s.id, s.customerName, s.planName, s.status, s.amount, s.currency, s.nextDue, s.correlationId]),
      ).join("")
    );
  }
  return (
    "id;ator;acao;recurso;recursoId;correlationId;ocorrido_em\n" +
    AUDIT_EVENTS.map((e) => line([e.id, e.actor, e.action, e.resource, e.resourceId, e.correlationId, e.occurredAt])).join("")
  );
}

export interface DlqQueueStub {
  queue: string;
  depth: number;
  oldestEnqueuedAt: string | null;
  lastError: string | null;
}

/** Profundidades DLQ por fila (stub — sem backend real Fase 6). */
const DLQ_QUEUES: DlqQueueStub[] = [
  {
    queue: "billing.webhook",
    depth: 3,
    oldestEnqueuedAt: "2026-10-09T08:12:00.000Z",
    lastError: "AsaasTimeout: webhook sem resposta em 5s",
  },
  {
    queue: "billing.recon",
    depth: 0,
    oldestEnqueuedAt: null,
    lastError: null,
  },
  {
    queue: "finance.settle",
    depth: 1,
    oldestEnqueuedAt: "2026-10-09T11:40:00.000Z",
    lastError: "IdempotencyConflict: chave repetida",
  },
];

export function mockDlqOverview(): { queues: DlqQueueStub[]; isStale: boolean; staleReason: string; asOf: string } {
  return {
    queues: DLQ_QUEUES,
    // Stub sem worker real — profundidade pode estar desatualizada.
    isStale: true,
    staleReason: "Snapshot de demonstração — sem worker DLQ real (stub Fase 6).",
    asOf: new Date().toISOString(),
  };
}

/** Replay stub (registra intenção; backend real re-enfileira + audit `queue.replay`). */
export function mockDlqReplay(queue: string): { queue: string; replayed: number; auditId: string } {
  const found = DLQ_QUEUES.find((q) => q.queue === queue);
  return { queue, replayed: found?.depth ?? 0, auditId: `aud-dlq-${Date.now()}` };
}

/* ------------------------------------------------------------------ */
/* Fase 7 — Produtos com licenças offline (espelha Nest `/v1/products`  */
/* + `/v1/licenses` issue/renew/revoke). Chave NUNCA em plaintext no    */
/* stub — só `keyMasked`. Preview de galeria só em sessão via           */
/* FileReader (stub: `previewUrl: null`); backend real usa object        */
/* storage + CDN (TODO).                                                 */
/* TODO(backend pronto): remover e buscar via BFF `app/api/products/*`. */
/* ------------------------------------------------------------------ */

function slugifyBase(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "produto";
}

export const MOCK_PRODUCTS: ProductView[] = [
  {
    id: "prd-aurum-pro",
    code: "aurum-pro",
    name: "Aurum Pro Mensal",
    slug: "aurum-pro-mensal",
    description: "Plano Pro com licenças offline.",
    status: "ACTIVE",
    machinesAllowed: 3,
    plans: [
      { id: "plan-aurum-pro-month", productId: "prd-aurum-pro", name: "Aurum Pro Mensal", billingInterval: "MONTH", priceCents: 14990, currency: "BRL", status: "ATIVO", validFrom: "2026-09-01T12:00:00.000Z", validTo: null, supersededBy: null },
      { id: "plan-aurum-pro-year", productId: "prd-aurum-pro", name: "Aurum Pro Anual", billingInterval: "YEAR", priceCents: 119900, currency: "BRL", status: "ATIVO", validFrom: "2026-09-01T12:00:00.000Z", validTo: null, supersededBy: null },
    ],
    gallery: [],
    createdAt: "2026-09-01T12:00:00.000Z",
  },
  {
    id: "prd-aurum-base",
    code: "aurum-base",
    name: "Aurum Base Anual",
    slug: "aurum-base-anual",
    description: null,
    status: "ACTIVE",
    machinesAllowed: 1,
    plans: [
      { id: "plan-aurum-base-year", productId: "prd-aurum-base", name: "Aurum Base Anual", billingInterval: "YEAR", priceCents: 119900, currency: "BRL", status: "ATIVO", validFrom: "2026-09-15T12:00:00.000Z", validTo: null, supersededBy: null },
    ],
    gallery: [],
    createdAt: "2026-09-15T12:00:00.000Z",
  },
];

/** Produtos criados em sessão (stub mutável só em memória). */
const MOCK_PRODUCTS_CREATED: ProductView[] = [];

function allProducts(): ProductView[] {
  return [...MOCK_PRODUCTS, ...MOCK_PRODUCTS_CREATED];
}

/** Histórico sintético de renovações (antiga desativada com motivo; preservado). */
const MOCK_LICENSE_HISTORY_EXTRA: LicenseHistoryEntry[] = [];

/** Lista paginada com filtro por nome (cursor = id do último item). */
export function mockProductPage(q: string, cursor?: string | null, limit = 20): Page<ProductView> {
  const needle = (q ?? "").toLowerCase();
  const filtered = allProducts().filter((p) => p.name.toLowerCase().includes(needle));
  const start = cursor ? filtered.findIndex((p) => p.id === cursor) + 1 : 0;
  const from = Math.max(start, 0);
  const slice = filtered.slice(from, from + limit);
  const last = slice[slice.length - 1];
  const hasMore = last !== undefined && filtered.findIndex((p) => p.id === last.id) < filtered.length - 1;
  return { data: slice, meta: { nextCursor: hasMore && last ? last.id : null, limit } };
}

export function mockProductByCode(code: string): ProductView | null {
  return allProducts().find((p) => p.code === code) ?? null;
}

function conflictError(): Error {
  const err = new Error("product code/slug já existe") as Error & { code: string; status: number };
  err.code = "CONFLICT";
  (err as { status: number }).status = 409;
  return err;
}

/** Cria produto sintetizando id/code/slug (valida code único → throw CONFLICT). */
export function mockCreateProduct(req: CreateProductRequest): ProductView {
  const ts = Date.now();
  const base = slugifyBase(req.name);
  const suffix = ts.toString(36).slice(-4);
  const code = (req.code?.trim() || `${base}-${suffix}`).toLowerCase();
  const slug = (req.slug?.trim() || `${base}-${suffix}`).toLowerCase();
  const existing = allProducts();
  if (existing.some((p) => p.code === code || p.slug === slug)) {
    throw conflictError();
  }
  const id = `prd-${ts}`;
  const createdAt = new Date(ts).toISOString();
  const plans: PlanView[] = [];
  if (req.monthlyPriceCents !== null && req.monthlyPriceCents !== undefined) {
    plans.push({
      id: `plan-${id}-month`,
      productId: id,
      name: `${req.name} Mensal`,
      billingInterval: "MONTH",
      priceCents: req.monthlyPriceCents,
      currency: "BRL",
      status: "ATIVO",
      validFrom: createdAt,
      validTo: null,
      supersededBy: null,
    });
  }
  if (req.annualPriceCents !== null && req.annualPriceCents !== undefined) {
    plans.push({
      id: `plan-${id}-year`,
      productId: id,
      name: `${req.name} Anual`,
      billingInterval: "YEAR",
      priceCents: req.annualPriceCents,
      currency: "BRL",
      status: "ATIVO",
      validFrom: createdAt,
      validTo: null,
      supersededBy: null,
    });
  }
  const gallery: ProductImage[] = (req.gallery ?? []).map((g, i) => ({
    id: `img-${id}-${i}`,
    name: g.name,
    size: g.size,
    // Stub: preview só em sessão via FileReader na UI; nunca persiste.
    // TODO(backend pronto): upload p/ object storage + CDN.
    previewUrl: null,
    sessao: true as const,
  }));
  const product: ProductView = {
    id,
    code,
    name: req.name,
    slug,
    description: req.description ?? null,
    status: "DRAFT",
    machinesAllowed: req.machinesAllowed,
    plans,
    gallery,
    createdAt,
  };
  MOCK_PRODUCTS_CREATED.push(product);
  return product;
}

/** Arquiva produto (status → ARCHIVED; terminal no backend). */
export function mockArchiveProduct(code: string): ProductView | null {
  const found = allProducts().find((p) => p.code === code) ?? null;
  if (!found) return null;
  const archived: ProductView = { ...found, status: "ARCHIVED" as ProductStatus };
  const idxCreated = MOCK_PRODUCTS_CREATED.findIndex((p) => p.code === code);
  if (idxCreated >= 0) {
    MOCK_PRODUCTS_CREATED[idxCreated] = archived;
  } else {
    const idx = MOCK_PRODUCTS.findIndex((p) => p.code === code);
    if (idx >= 0) MOCK_PRODUCTS[idx] = archived;
  }
  return archived;
}

/** Emite licença mascarada (chave NUNCA em plaintext no stub). */
export function mockIssueProductLicense(
  productCode: string,
  req: IssueProductLicenseRequest,
): { licenseId: string; keyMasked: string; auditId: string } {
  void productCode;
  void req;
  const ts = Date.now();
  const tail = ts.toString(36).toUpperCase().slice(-4).padStart(4, "0");
  return {
    licenseId: `lic-${ts}`,
    keyMasked: `AURUM-••••-••••-${tail}`,
    auditId: `aud-${ts.toString(36)}`,
  };
}

/** Renova com substituição (antiga desativada com motivo; histórico preservado). */
export function mockRenewReplace(
  licenseId: string,
  req: RenewReplaceRequest,
): { newLicenseId: string; revoked: boolean; auditId: string } {
  void req;
  const ts = Date.now();
  const newLicenseId = `lic-${ts}`;
  MOCK_LICENSE_HISTORY_EXTRA.push({
    licenseId,
    keyMasked: "AURUM-••••-••••-••••",
    status: "revoked",
    reason: req.motivo,
    endedAt: new Date(ts).toISOString(),
    replacedBy: newLicenseId,
  });
  return { newLicenseId, revoked: true, auditId: `aud-${ts.toString(36)}` };
}

/** Histórico da licença/cliente (inclui lic-001/lic-002 + sintéticas). */
export function mockLicenseHistory(ref?: string): LicenseHistoryEntry[] {
  const base: LicenseHistoryEntry[] = [
    {
      licenseId: "lic-001",
      keyMasked: "AURUM-••••-••••-AB12",
      status: "active",
      reason: null,
      endedAt: null,
      replacedBy: null,
    },
    {
      licenseId: "lic-002",
      keyMasked: "AURUM-••••-••••-CD34",
      status: "expired",
      reason: "Expirada sem renovação",
      endedAt: "2026-09-28T12:00:00.000Z",
      replacedBy: null,
    },
  ];
  const extra = MOCK_LICENSE_HISTORY_EXTRA.filter(
    (e) => e.licenseId === ref || e.replacedBy === ref,
  );
  // TODO(backend pronto): filtro por titular real (customerId → licenças do
  // cliente). Stub: `cus-001` detém lic-001/lic-002; demais refs agregam.
  if (!ref || ref === "all" || ref === "cus-001") return [...base, ...MOCK_LICENSE_HISTORY_EXTRA];
  if (ref.startsWith("cus-")) return [...extra];
  return [...base.filter((b) => b.licenseId === ref), ...extra];
}

/* ------------------------------------------------------------------ */
/* Preço versionado + clientes ativos (Fase 7, sem UI). Preço IMUTÁVEL: */
/* novo preço = nova linha; a anterior fecha (SUBSTITUIDO +             */
/* validTo/supersededBy). Recebíveis com fatura (contrato fechado)      */
/* NUNCA mudam.                                                         */
/* TODO(backend pronto): remover e orquestrar via BFF                    */
/* `app/api/products/[code]/plans/change-price` + `/clients`.           */
/* ------------------------------------------------------------------ */

function priceChangeError(code: string, message: string, status: number): Error {
  const err = new Error(message) as Error & { code: string; status: number };
  err.code = code;
  err.status = status;
  return err;
}

/**
 * Troca de preço versionada (stub mutável em memória).
 * Valida preço > 0, `effectiveFrom` data válida, motivo ≥ 10 e linha ATIVA
 * do ciclo; fecha a atual (`validTo` + SUBSTITUIDO) e abre a nova linha.
 * Propaga p/ recebíveis SEM fatura (`invoiceId == null`) do mesmo produto
 * (`ReceivableView.product` = nome do produto) com vencimento ≥ vigência.
 */
export function mockChangePlanPrice(
  productCode: string,
  req: PlanPriceChangeRequest,
): PlanPriceChangeResult {
  if (!Number.isInteger(req.newPriceCents) || req.newPriceCents <= 0) {
    throw priceChangeError("UNPROCESSABLE", "Novo preço deve ser inteiro > 0 (centavos).", 422);
  }
  if (typeof req.effectiveFrom !== "string" || Number.isNaN(Date.parse(req.effectiveFrom))) {
    throw priceChangeError("UNPROCESSABLE", "effectiveFrom deve ser data válida.", 422);
  }
  if (typeof req.motivo !== "string" || req.motivo.trim().length < 10) {
    throw priceChangeError("UNPROCESSABLE", "Motivo deve ter ao menos 10 caracteres.", 422);
  }
  if (req.billingInterval !== "MONTH" && req.billingInterval !== "YEAR") {
    throw priceChangeError("UNPROCESSABLE", "billingInterval deve ser MONTH ou YEAR.", 422);
  }
  const product = allProducts().find((p) => p.code === productCode) ?? null;
  if (!product) {
    throw priceChangeError("NOT_FOUND", "Produto não encontrado.", 404);
  }
  const current =
    product.plans.find(
      (pl) => pl.billingInterval === req.billingInterval && pl.status === "ATIVO",
    ) ?? null;
  if (!current) {
    throw priceChangeError("CONFLICT", "Nenhuma linha ATIVA para o ciclo informado.", 409);
  }
  const ts = Date.now();
  const newId = `plan-${productCode}-${req.billingInterval.toLowerCase()}-${ts.toString(36)}`;
  // Fecha a linha atual (referência viva no array — mutação em memória).
  current.validTo = req.effectiveFrom;
  current.status = "SUBSTITUIDO";
  current.supersededBy = newId;
  // Abre a nova linha (mesmo produto/ciclo, novo preço).
  const newPlan: PlanView = {
    id: newId,
    productId: current.productId,
    name: current.name,
    billingInterval: current.billingInterval,
    priceCents: req.newPriceCents,
    currency: "BRL",
    status: "ATIVO",
    validFrom: req.effectiveFrom,
    validTo: null,
    supersededBy: null,
  };
  product.plans.push(newPlan);
  // Propaga p/ recebíveis abertos (sem fatura) do mesmo produto.
  const newAmount = Math.round(req.newPriceCents) / 100;
  const effMs = Date.parse(req.effectiveFrom);
  const d = new Date(req.effectiveFrom);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const rotulo = req.billingInterval === "MONTH" ? "Mensal" : "Anual";
  const priceNote = `${rotulo} vigente desde ${dd}/${mm}/${yyyy}`;
  const updatedReceivables: string[] = [];
  for (const r of RECEIVABLES) {
    // Contrato fechado (com fatura) NUNCA muda de valor.
    if (r.invoiceId != null) continue;
    if (r.product !== product.name) continue;
    if (Number.isNaN(Date.parse(r.dueDate)) || Date.parse(r.dueDate) < effMs) continue;
    r.amount = newAmount;
    r.priceNote = priceNote;
    updatedReceivables.push(r.id);
  }
  return { plan: newPlan, oldPlanId: current.id, updatedReceivables, auditId: `aud-price-${ts}` };
}

/**
 * Clientes com licenças do produto (stub: `LICENSES.productId`).
 * `active` = licenças `active`; `grace` = `grace` ou `degraded`.
 * Só retorna clientes com ao menos uma licença ativa/em graça.
 */
export function mockProductActiveClients(productCode: string): ProductActiveClient[] {
  const byCustomer = new Map<string, ProductActiveClient>();
  for (const customer of CUSTOMERS) {
    for (const lic of LICENSES[customer.id] ?? []) {
      if (lic.productId !== productCode) continue;
      let entry = byCustomer.get(customer.id);
      if (!entry) {
        entry = { customerId: customer.id, customerName: customer.name, active: 0, grace: 0 };
        byCustomer.set(customer.id, entry);
      }
      if (lic.status === "grace" || lic.degraded) entry.grace += 1;
      else if (lic.status === "active") entry.active += 1;
    }
  }
  return Array.from(byCustomer.values()).filter((e) => e.active > 0 || e.grace > 0);
}
