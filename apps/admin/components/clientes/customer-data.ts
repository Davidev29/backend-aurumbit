import {
  mockAuditPage,
  mockContracts,
  mockCustomerDetail,
  mockDevices,
  mockInvoicePage,
  mockLicenses,
  mockSessions,
  mockSubscriptionPage,
} from "@/lib/mocks";
import type {
  AuditEventView,
  ContractView,
  CustomerDetail,
  DeviceView,
  InvoiceView,
  LicenseView,
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

/** Mascara CPF (11) / CNPJ (14) p/ exibição (LGPD — sem dígito além dos 2 finais). */
export function maskDoc(digits: string): string {
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`;
  return "••••";
}

export function getCustomerData(customerId: string): CustomerData | null {
  const customer = registeredCustomers.get(customerId) ?? mockCustomerDetail(customerId);
  if (!customer) return null;
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
  const audit = mockAuditPage({}, null, 200).data.filter(
    (e) => corrIds.has(e.correlationId) || (e.resource === "license" && licenseIds.has(e.resourceId)),
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
