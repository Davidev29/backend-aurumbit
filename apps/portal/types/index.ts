/**
 * Tipos do Portal AurumBit — Landing Page + Área do Cliente
 * Forward-compatible com contratos do backend (libs/contracts + Nest DTOs)
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

/* ============================================================
 * Produtos (Catálogo Público) — espelha GET /v1/products
 * ============================================================ */
export type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";
export type BillingInterval = "MONTH" | "YEAR" | "ONE_TIME";

export interface PlanView {
  id: string;
  productId: string;
  name: string;
  billingInterval: BillingInterval;
  priceCents: number;
  currency: "BRL";
  status: "ATIVO" | "SUBSTITUIDO" | "DRAFT" | "ARCHIVED";
  validFrom: string;
  validTo: string | null;
  supersededBy: string | null;
  features?: Array<{ featureCode: string; channel?: "WEB" | "DESKTOP" | "BOTH"; value?: string }>;
}

export interface ProductImage {
  id: string;
  name: string;
  size: number;
  url: string;
  alt?: string;
  order: number;
}

export interface ProductView {
  id: string;
  code: string;
  name: string;
  slug: string;
  description: string | null;
  shortDescription?: string;
  status: ProductStatus;
  machinesAllowed: number;
  plans: PlanView[];
  gallery: ProductImage[];
  category?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface ProductFilters {
  q?: string;
  category?: string;
  status?: ProductStatus;
  cursor?: string;
  limit?: number;
}

/* ============================================================
 * Autenticação & Usuário
 * ============================================================ */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  mfaRequired?: boolean;
  mfaTicket?: string;
}

export interface MeResponse {
  id: string;
  email: string;
  name: string;
  displayName?: string;
  avatarUrl?: string;
  mfaRequired: boolean;
  mfaVerified: boolean;
  organizationId?: string;
  permissions: string[];
  role?: "OWNER" | "ADMIN" | "FINANCE" | "MEMBER" | "CUSTOMER";
  createdAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  deviceLabel?: string;
  rememberMe?: boolean;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
  deviceLabel?: string;
}

export interface AuthResponse {
  ok: boolean;
  mfaRequired?: boolean;
  mfaTicket?: string;
  me?: MeResponse;
}

/* ============================================================
 * Área do Cliente — Produtos Adquiridos / Licenças
 * ============================================================ */
export type LicenseStatus = "active" | "grace" | "suspended" | "expired" | "revoked";
export type LicenseOrigin = "BONUS" | "CONTRACT" | "SUBSCRIPTION" | "LICENSE";

export interface CustomerLicenseView {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  productImage?: string;
  planName: string;
  billingInterval: BillingInterval;
  keyMasked: string;
  keyPrefix: string;
  keyLast4: string;
  status: LicenseStatus;
  startsAt: string;
  expiresAt: string;
  graceUntil?: string;
  degraded?: boolean;
  machinesUsed: number;
  machinesAllowed: number;
  origin: LicenseOrigin;
  lastActivity?: string;
  downloadUrls?: {
    windows?: string;
    macos?: string;
    linux?: string;
    web?: string;
  };
  documentationUrl?: string;
  supportUrl?: string;
}

export interface CustomerInvoiceView {
  id: string;
  amount: number;
  currency: "BRL";
  status: "PENDING" | "PAID" | "OVERDUE" | "REFUNDED" | "CANCELLED";
  dueDate: string;
  paidAt?: string | null;
  externalId: string;
  provider: "ASAAS";
  correlationId: string;
  productName?: string;
  planName?: string;
  downloadUrl?: string; // PDF
}

export interface CustomerSubscriptionView {
  id: string;
  planName: string;
  status: "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED" | "TRIAL";
  amount: number;
  currency: "BRL";
  nextDue: string;
  externalId: string;
  productName?: string;
}

export interface CustomerProfileData {
  id: string;
  email: string;
  name: string;
  displayName?: string;
  avatarUrl?: string;
  phone?: string;
  cellphone?: string;
  birthDate?: string | null;
  gender?: string;
  bio?: string;
  address?: {
    cep?: string;
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    country?: string;
  };
  documents?: Array<{
    id: string;
    type: "RG" | "CNH" | "CPF" | "PASSPORT" | "OTHER";
    numberMasked: string;
    issuer?: string;
    state?: string;
    expiresAt?: string | null;
  }>;
  createdAt: string;
  updatedAt?: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
  phone?: string;
  cellphone?: string;
  birthDate?: string | null;
  gender?: string;
  bio?: string;
  address?: CustomerProfileData["address"];
}

/* ============================================================
 * Checkout / Compra
 * ============================================================ */
export interface CheckoutItem {
  productId: string;
  productCode: string;
  productName: string;
  planId: string;
  planName: string;
  billingInterval: BillingInterval;
  priceCents: number;
  quantity: number;
}

export interface CheckoutSession {
  id: string;
  /** Fase 8: pedido idempotente (orderId) + fatura + licença (quando emitida). */
  orderId?: string;
  invoiceId?: string;
  licenseId?: string;
  items: CheckoutItem[];
  totalCents: number;
  currency: "BRL";
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "EXPIRED";
  asaasUrl?: string;
  expiresAt: string;
  createdAt: string;
}

export interface CreateCheckoutRequest {
  /** Idempotência cliente: replay do mesmo orderId retorna a mesma sessão. */
  orderId?: string;
  items: Array<{
    productCode: string;
    planId: string;
    quantity: number;
  }>;
  paymentMethod?: "pix" | "boleto" | "cartao";
  successUrl?: string;
  cancelUrl?: string;
}

/* ============================================================
 * Notificações / Toast
 * ============================================================ */
export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

/* ============================================================
 * Configuração da API
 * ============================================================ */
export const API_CONFIG = {
  baseUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
  endpoints: {
    products: "/v1/products",
    productsDetail: (code: string) => `/v1/products/${code}`,
    auth: {
      login: "/v1/auth/login",
      register: "/v1/auth/register",
      refresh: "/v1/auth/refresh",
      logout: "/v1/auth/logout",
      me: "/v1/auth/me",
      forgot: "/v1/auth/forgot",
      reset: "/v1/auth/reset",
      changePassword: "/v1/auth/change-password",
    },
    customer: {
      licenses: "/v1/customer/licenses",
      invoices: "/v1/customer/invoices",
      subscriptions: "/v1/customer/subscriptions",
      profile: "/v1/customer/profile",
      checkout: "/v1/customer/checkout",
    },
  },
} as const;