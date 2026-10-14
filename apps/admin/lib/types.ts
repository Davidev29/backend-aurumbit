/**
 * Tipos do Admin (Fase 2 — stubs espelhando `libs/contracts` + domínios futuros).
 *
 * TODO(backend pronto): gerar/importar de `@aurum-bit/contracts` (envelopes
 * ApiError/Page/LicenseKeyView) e dos DTOs do Nest (`apps/api`). Hoje o BFF
 * (`app/api/auth/*`) usa mocks de `lib/mocks.ts`. Consumidores DEVEM ignorar
 * campos desconhecidos (forward-compatible, PROJECT/REQUIREMENTS).
 */

export interface ApiError {
  code: string;
  message: string;
  correlationId?: string;
}

export interface PageMeta {
  nextCursor: string | null;
  limit: number;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

/** Licença sempre mascarada na UI (PROJECT §2). Nunca trafega plaintext. */
export type LicenseStatus = "active" | "grace" | "suspended" | "expired" | "revoked";

/** Origem do entitlement (espelha `CheckAccessResponse.origin` — libs/contracts access.ts). */
export type LicenseOrigin = "BONUS" | "CONTRACT" | "SUBSCRIPTION" | "LICENSE";

export interface LicenseView {
  id: string;
  /** Produto de origem (catálogo Fase 7; backend tem `productId`). */
  productId?: string;
  keyMasked: string;
  keyPrefix: string;
  keyLast4: string;
  status: LicenseStatus;
  startsAt: string;
  expiresAt: string;
  /** Fim da tolerância degradada (`expires_at + 3d` — PROJECT §1). */
  graceUntil?: string;
  /** `true` ⇔ dentro da graça: backend responde `degraded:true` + `X-Aurum-Grace`. */
  degraded?: boolean;
  /** Máquinas vinculadas / limite (enforcement backend FOR UPDATE — REQUIREMENTS §2). */
  machinesUsed: number;
  machinesAllowed: number;
  origin: LicenseOrigin;
  /** Última atividade p/ heartbeat (REQUIREMENTS §4: 60s / window 5min). */
  lastActivity?: string;
}

/** Dispositivo vinculado à licença (`device_hash` HMAC, nunca hardware cru — PROJECT §4). */
export interface DeviceView {
  id: string;
  licenseId: string;
  label: string;
  /** Hash mascarado p/ suporte (`hmac…AB12`, nunca o hash completo). */
  deviceHashMasked: string;
  lastActivity: string;
  live: boolean;
  suspectClone?: boolean;
}

/** Resposta da revelação auditada (`POST /v1/licenses/:id/reveal` — PROJECT §2). */
export interface LicenseRevealResponse {
  key: string;
  auditId: string;
}

export interface AdjustMachinesRequest {
  delta: number;
  justificativa: string;
}

export interface BonusGrantRequest {
  reason: string;
  /** `null` = vitalícia revogável (REQUIREMENTS §2). */
  endsAt: string | null;
}

export interface RenewRequest {
  months: 1 | 12;
}

export interface RevokeRequest {
  motivo: string;
  confirmacao: boolean;
}

export interface CustomerSummary {
  id: string;
  name: string;
  docMasked: string;
  organizationId: string;
  status: "active" | "blocked";
  licensesCount: number;
}

export interface CustomerDetail extends CustomerSummary {
  email: string;
  createdAt: string;
}

export interface ContractView {
  id: string;
  productName: string;
  priceFrozen: number;
  currency: "BRL";
  startedAt: string;
}

export interface SessionView {
  id: string;
  deviceLabel: string;
  lastActivity: string;
  live: boolean;
  ipMasked: string;
}

export type Role = "OWNER" | "ADMIN" | "FINANCE" | "MEMBER";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  organizationId: string;
}

export interface MeResponse {
  id: string;
  email: string;
  name: string;
  mfaRequired: boolean;
  mfaVerified: boolean;
  organizationId: string;
  /** Claims efetivas (ex.: "finance.read" explícito escopado — PROJECT §3). */
  permissions: string[];
}

export type Period = "week" | "month" | "year";

export interface Organization {
  id: string;
  name: string;
}

/* ------------------------------------------------------------------ */
/* Fase 4 — Admin billing (cobranças/assinaturas/auditoria).            */
/* Espelha `libs/contracts` do domínio billing + audit (REQUIREMENTS   */
/* §3). Sem financeiro realizado aqui — valores são de cobrança (Fase  */
/* 5 projeta previsto/pendente/realizado). Consumidores DEVEM ignorar   */
/* campos desconhecidos (forward-compatible).                           */
/* ------------------------------------------------------------------ */

/** Estado da fatura local (máquina `assertTransition` no backend + DRAFT). */
export type InvoiceStatus = "DRAFT" | "PENDING" | "PAID" | "OVERDUE" | "REFUNDED" | "CANCELLED";

export interface InvoiceView {
  id: string;
  customerId: string;
  customerName: string;
  amount: number;
  currency: "BRL";
  status: InvoiceStatus;
  /** Vencimento (filtro da listagem). */
  dueDate: string;
  paidAt?: string | null;
  /** Charge no Asaas (`UNIQUE(provider,externalId)` — PROJECT §5). */
  externalId: string;
  provider: "ASAAS";
  /** Propagado p/ outbox, Resend e audit (REQUIREMENTS §4). */
  correlationId: string;
  createdAt: string;
}

/** Pagamento vinculado à fatura (nunca regride estado terminal — PROJECT §5). */
export type PaymentStatus = "PENDING" | "CONFIRMED" | "FAILED" | "REFUNDED";

export interface PaymentView {
  id: string;
  invoiceId: string;
  externalId: string;
  amount: number;
  currency: "BRL";
  status: PaymentStatus;
  method?: string;
  paidAt?: string | null;
  correlationId: string;
  createdAt: string;
}

export type SubscriptionStatus =
  | "DRAFT"
  | "ACTIVE"
  | "PAST_DUE"
  | "SUSPENDED"
  | "CANCELLED"
  | "EXPIRED"
  | "TRIAL";

export interface SubscriptionView {
  id: string;
  customerId: string;
  customerName: string;
  planName: string;
  status: SubscriptionStatus;
  amount: number;
  currency: "BRL";
  /** Próxima cobrança (coluna `nextDue` da listagem). */
  nextDue: string;
  externalId: string;
  correlationId: string;
  createdAt: string;
  cancelledAt?: string | null;
}

/** Evento de auditoria append-only (sem UPDATE/DELETE — REQUIREMENTS §4). */
export interface AuditEventView {
  id: string;
  actor: string;
  action: string;
  resource: string;
  resourceId: string;
  correlationId: string;
  occurredAt: string;
  /** Já mascarado no backend (sem PII sensível — PROJECT §4). */
  metadataMasked: Record<string, unknown>;
}

export interface CancelSubscriptionRequest {
  motivo: string;
  confirmacao: boolean;
}

export interface RefundInvoiceRequest {
  motivo: string;
  confirmacao: boolean;
}

export interface InvoiceDetail {
  invoice: InvoiceView;
  payments: PaymentView[];
}

/* ------------------------------------------------------------------ */
/* Fase 5 — Admin financeiro (REQUIREMENTS §3, PROJECT §3/§5).          */
/* Previsto/pendente/realizado: `Payable`/`Receivable` são o previsto   */
/* (contas a pagar/receber); `Transaction` é o realizado (único        */
/* mutador de saldo); `ProjectionSnapshot` agrega receita×despesa.     */
/* Consumidores DEVEM ignorar campos desconhecidos                      */
/* (forward-compatible).                                                */
/* ------------------------------------------------------------------ */

/** Estado de conta a pagar (máquina `assertTransition` no backend). */
export type PayableStatus = "PREVISTO" | "PENDENTE" | "PAGO" | "VENCIDO" | "CANCELADO";

/** Estado de conta a receber (máquina `assertTransition` no backend). */
export type ReceivableStatus = "PREVISTO" | "PENDENTE" | "RECEBIDO" | "VENCIDO" | "CANCELADO";

export type FinanceRecurrence = "UNICA" | "MENSAL" | "TRIMESTRAL" | "ANUAL";

export interface PayableView {
  id: string;
  supplier: string;
  category: string;
  product?: string;
  amount: number;
  currency: "BRL";
  status: PayableStatus;
  /** Vencimento (coluna `dueDate` + filtro da listagem). */
  dueDate: string;
  paidAt?: string | null;
  recurrence: FinanceRecurrence;
  correlationId: string;
  createdAt: string;
}

export interface ReceivableView {
  id: string;
  customerId: string;
  customerName: string;
  category: string;
  product?: string;
  amount: number;
  currency: "BRL";
  status: ReceivableStatus;
  /** Vencimento (coluna `dueDate` + filtro da listagem). */
  dueDate: string;
  receivedAt?: string | null;
  recurrence: FinanceRecurrence;
  /** Fatura de origem (elo charge→invoice→receivable — Fase 5). */
  invoiceId?: string | null;
  /** Nota de vigência do preço aplicado (propagação de `change-price` — Fase 7). */
  priceNote?: string;
  correlationId: string;
  createdAt: string;
}

/** Lançamento realizado no extrato (único mutador de saldo — REQUIREMENTS §3). */
export type TransactionKind = "RECEITA" | "DESPESA";

export interface TransactionView {
  id: string;
  kind: TransactionKind;
  description: string;
  category: string;
  product?: string;
  amount: number;
  currency: "BRL";
  /** Data da liquidação (extrato realizado). */
  settledAt: string;
  /** Origem: conta a pagar/receber liquidada. */
  sourceId: string;
  sourceKind: "payable" | "receivable";
  correlationId: string;
  createdAt: string;
}

/** Ponto de receita×despesa da projeção (agrega `ProjectionSnapshot` — hash no backend). */
export interface ProjectionPoint {
  /** Rótulo do bucket (ex. `2026-W41`, `2026-10`, `2026`). */
  bucket: string;
  receita: number;
  despesa: number;
}

export interface FinanceSummary {
  previsto: number;
  pendente: number;
  realizado: number;
  /** Inadimplência: valor vencido (recebíveis `VENCIDO`). */
  inadimplente: number;
  /** Taxa de inadimplência 0..1 (vencido / total a receber). */
  taxaInadimplencia: number;
  currency: "BRL";
  /** `true` ⇔ snapshot desatualizado (reconciliação pendente) — exibe StaleBanner. */
  isStale: boolean;
  staleReason?: string;
  asOf: string;
}

export interface ProjectionResponse {
  points: ProjectionPoint[];
  period: Period;
  isStale: boolean;
  staleReason?: string;
  asOf: string;
}

export interface FinanceFilters {
  status?: string | null;
  category?: string | null;
  product?: string | null;
  from?: string | null;
  to?: string | null;
}

/** Liquidação pagar/baixar (exige `finance.manage`; motivo >= 10 + confirmação na UI). */
export interface SettleFinanceRequest {
  motivo: string;
  confirmacao: boolean;
}

export type FinanceExportScope = "payables" | "receivables" | "transactions";

/* ------------------------------------------------------------------ */
/* Fase 7 — Produtos com licenças offline (catálogo + emissão/renovação). */
/* Espelha Nest `/v1/products/*` + `/v1/licenses` (issue/renew/revoke). */
/* Preview de galeria é só em sessão via FileReader (stub); backend real */
/* usa object storage + CDN (TODO). Chave NUNCA em plaintext no stub —   */
/* só `keyMasked`. Consumidores DEVEM ignorar campos desconhecidos       */
/* (forward-compatible).                                                 */
/* TODO(backend pronto): gerar/importar de `@aurum-bit/contracts` + DTOs  */
/* do Nest (`apps/api/src/modules/products`, `licensing`).               */
/* ------------------------------------------------------------------ */

/** Estado do produto no catálogo (backend: `ARCHIVED` é terminal). */
export type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

/** Intervalo de cobrança da linha de catálogo (preço imutável — nova linha p/ novo preço). */
export type BillingInterval = "MONTH" | "YEAR";

export interface PlanView {
  id: string;
  productId: string;
  name: string;
  billingInterval: BillingInterval;
  priceCents: number;
  currency: "BRL";
  /** Vigência da linha de catálogo (preço imutável — novo preço = nova linha). */
  status: "ATIVO" | "SUBSTITUIDO";
  validFrom: string;
  validTo: string | null;
  supersededBy: string | null;
}

/** Troca de preço versionada (fecha linha atual + abre nova; propaga a recebíveis abertos). */
export interface PlanPriceChangeRequest {
  billingInterval: BillingInterval;
  newPriceCents: number;
  effectiveFrom: string;
  motivo: string;
  confirmacao: boolean;
}

export interface PlanPriceChangeResult {
  plan: PlanView;
  oldPlanId: string;
  updatedReceivables: string[];
  auditId: string;
}

/** Clientes com licenças ativas/graça por produto (agregado de licenças por `productId`). */
export interface ProductActiveClient {
  customerId: string;
  customerName: string;
  active: number;
  grace: number;
}

/**
 * Imagem da galeria do produto.
 * - `previewUrl` local (FileReader, `sessao: true`) ou proxy do BFF
 *   (`/api/products/:code/images/:id`, `sessao: false`, bytes na VPS).
 */
export interface ProductImage {
  id: string;
  name: string;
  size: number;
  previewUrl: string | null;
  sessao: boolean;
}

export interface ProductView {
  id: string;
  code: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProductStatus;
  machinesAllowed: number;
  plans: PlanView[];
  gallery: ProductImage[];
  createdAt: string;
}

/** Entrada de histórico da licença (substituída preserva motivo + sucessora). */
export interface LicenseHistoryEntry {
  licenseId: string;
  keyMasked: string;
  status: "active" | "revoked" | "expired";
  reason: string | null;
  endedAt: string | null;
  replacedBy: string | null;
}

/** Emissão de licença de produto (BFF → Nest `POST /v1/licenses` issue). */
export interface IssueProductLicenseRequest {
  customerId: string;
  planId: string;
  /**
   * Intervalo da linha de catálogo. A UI passa `PlanView.billingInterval`
   * (`MONTH`/`YEAR`); o BFF normaliza p/ `monthly`/`annual` no upstream real.
   */
  kind: "monthly" | "annual" | BillingInterval;
}

/** Arquivamento de produto (destrutivo: motivo + confirmação, como revoke/refund/cancel). */
export interface ArchiveProductRequest {
  motivo: string;
  confirmacao: true;
}

/** Renovação com substituição (antiga desativada com motivo; histórico preservado). */
export interface RenewReplaceRequest {
  motivo: string;
  confirmacao: true;
}

export interface CreateProductRequest {
  name: string;
  code?: string;
  slug?: string;
  description?: string;
  machinesAllowed: number;
  // `null` ou ausente (`undefined`) = sem linha de catálogo p/ o intervalo.
  monthlyPriceCents: number | null | undefined;
  annualPriceCents: number | null | undefined;
  gallery: Array<{ name: string; size: number }>;
}

/* ------------------------------------------------------------------ */
/* Perfil do operador (área "Meu perfil" — foto + dados + documentos).  */
/* Stub frontend-first: persiste em `localStorage` (store zustand) e   */
/* espelha `MeResponse` p/ identidade; backend real usa Nest            */
/* `GET/PATCH /v1/users/me` + object storage p/ foto/anexos (TODO).    */
/* Documentos NUNCA em plaintext integral na listagem — só mascarado    */
/* (LGPD — PROJECT §4). Consumidores DEVEM ignorar campos              */
/* desconhecidos (forward-compatible).                                  */
/* TODO(backend pronto): gerar/importar do DTO do Nest                  */
/* (`apps/api/src/modules/users`).                                      */
/* ------------------------------------------------------------------ */

/** Tipo de documento pessoal aceito no perfil. */
export type UserDocumentType = "RG" | "CNH" | "CPF" | "PASSAPORTE" | "CTPS" | "TITULO_ELEITOR" | "OUTRO";

export interface UserDocument {
  id: string;
  tipo: UserDocumentType;
  /** Número mascarado p/ listagem (ex.: `***.***.***-**`, `***·1234`). */
  numeroMasked: string;
  /** Número completo — só em edição/sessão, nunca logado (LGPD). */
  numero?: string;
  orgaoEmissor?: string;
  uf?: string;
  validade?: string | null;
  /** Anexo em sessão (nome/tamanho; bytes só via FileReader p/ preview). */
  anexoNome?: string | null;
  anexoTamanho?: number | null;
  createdAt: string;
}

export interface UserAddress {
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  pais?: string;
}

export interface UserProfileData {
  nomeExibicao: string;
  nomeCompleto?: string;
  email: string;
  telefone?: string;
  celular?: string;
  dataNascimento?: string | null;
  genero?: string;
  cargo?: string;
  departamento?: string;
  bio?: string;
  /** Foto em sessão via FileReader (dataURL) — backend real usa object storage + CDN (TODO). */
  fotoPreviewUrl?: string | null;
  fotoNome?: string | null;
  endereco: UserAddress;
  documentos: UserDocument[];
  updatedAt?: string;
}

export interface UpdateProfileRequest {
  nomeExibicao?: string;
  nomeCompleto?: string;
  telefone?: string;
  celular?: string;
  dataNascimento?: string | null;
  genero?: string;
  cargo?: string;
  departamento?: string;
  bio?: string;
  endereco?: UserAddress;
}
