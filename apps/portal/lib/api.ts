import type {
  Page,
  ProductView,
  ProductFilters,
  MeResponse,
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  CustomerLicenseView,
  CustomerInvoiceView,
  CustomerSubscriptionView,
  CustomerProfileData,
  UpdateProfileRequest,
  CheckoutSession,
  CreateCheckoutRequest,
} from "@/types";

export class ApiClientError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Cliente HTTP do Portal → BFF (`/api/*`, mesma origem).
 * - `credentials: "include"` (cookies httpOnly, nunca localStorage p/ token).
 * - BFF proxya p/ Nest `/v1/*` quando `API_INTERNAL_URL` configurado, senão stub.
 * - Em 401 (fora de `/api/auth/*`): 1 rotação via refresh com voo único + 1 retry.
 */
let refreshPromise: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function bffFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = async (): Promise<Response> =>
    fetch(path, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });

  const readError = async (res: Response): Promise<never> => {
    let code = "INTERNAL";
    let message = `Falha na requisição (${res.status}).`;
    try {
      const body = (await res.json()) as { code?: unknown; message?: unknown };
      if (typeof body.code === "string") code = body.code;
      if (typeof body.message === "string") {
        message = body.message;
      } else if (Array.isArray(body.message)) {
        // `ValidationPipe` do Nest responde `message: string[]`.
        const parts = body.message.filter((m): m is string => typeof m === "string");
        if (parts.length > 0) message = parts.join(" ");
      }
    } catch {
      // Mantém mensagem padrão.
    }
    throw new ApiClientError(res.status, code, message);
  };

  const parse = async (res: Response): Promise<T> => {
    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  };

  let res = await doFetch();

  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    const rotated = await refreshSession();
    if (rotated) {
      res = await doFetch();
      if (res.ok) return parse(res);
    }
  }

  if (!res.ok) return readError(res);
  return parse(res);
}

export const apiGet = <T>(path: string, init?: RequestInit): Promise<T> =>
  bffFetch<T>(path, { ...init, method: "GET" });

function idempotencyHeaders(): Record<string, string> {
  const key =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { "Idempotency-Key": key };
}

export const apiPost = <T>(path: string, body?: unknown, init?: RequestInit): Promise<T> =>
  bffFetch<T>(path, {
    ...init,
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...idempotencyHeaders(), ...(init?.headers ?? {}) },
  });

export const apiPatch = <T>(path: string, body?: unknown, init?: RequestInit): Promise<T> =>
  bffFetch<T>(path, {
    ...init,
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...idempotencyHeaders(), ...(init?.headers ?? {}) },
  });

export const apiDelete = <T>(path: string, init?: RequestInit): Promise<T> =>
  bffFetch<T>(path, { ...init, method: "DELETE" });

/* ============================================================
 * Produtos (público, via BFF)
 * ============================================================ */

export function listProducts(filters: ProductFilters = {}): Promise<Page<ProductView>> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return apiGet<Page<ProductView>>(`/api/products${qs ? `?${qs}` : ""}`);
}

export function getProduct(code: string): Promise<ProductView> {
  return apiGet<ProductView>(`/api/products/${encodeURIComponent(code)}`);
}

/* ============================================================
 * Autenticação (via BFF, cookies httpOnly)
 * ============================================================ */

export function login(data: LoginRequest): Promise<AuthResponse> {
  return apiPost<AuthResponse>("/api/auth/login", data);
}

export function register(
  data: RegisterRequest | { name: string; email: string; password: string; confirmPassword: string; acceptTerms: boolean }
): Promise<AuthResponse> {
  return apiPost<AuthResponse>("/api/auth/register", data);
}

export function logout(): Promise<void> {
  return apiPost<void>("/api/auth/logout");
}

/**
 * 1 fetch de identidade por vez: o provider monta em cada página e o
 * StrictMode dev invoca o efeito 2x — sem dedupe, cada navegação disparava
 * vários `GET /api/auth/me`.
 */
let mePromise: Promise<MeResponse> | null = null;

export function getMe(): Promise<MeResponse> {
  if (!mePromise) {
    mePromise = apiGet<MeResponse>("/api/auth/me").finally(() => {
      mePromise = null;
    });
  }
  return mePromise;
}

export function verifyEmail(token: string): Promise<{ ok: boolean; stub?: boolean }> {
  return apiPost<{ ok: boolean; stub?: boolean }>("/api/auth/verify-email", { token });
}

export function resendVerification(email: string): Promise<{ ok: boolean; stub?: boolean }> {
  return apiPost<{ ok: boolean; stub?: boolean }>("/api/auth/resend-verification", { email });
}

export function requestPasswordReset(_email: string): Promise<{ ok: boolean }> {
  return Promise.resolve({ ok: true });
}

export function resetPassword(_token: string, _newPassword: string): Promise<{ ok: boolean }> {
  return Promise.resolve({ ok: true });
}

export function changePassword(_current: string, _newPassword: string): Promise<{ ok: boolean }> {
  return Promise.resolve({ ok: true });
}

/* ============================================================
 * Área do Cliente (via BFF)
 * ============================================================ */

export function getMyLicenses(): Promise<CustomerLicenseView[]> {
  return apiGet<CustomerLicenseView[]>("/api/me/licenses");
}

export function getMyInvoices(): Promise<CustomerInvoiceView[]> {
  return apiGet<CustomerInvoiceView[]>("/api/me/invoices");
}

export function getMySubscriptions(): Promise<CustomerSubscriptionView[]> {
  return apiGet<CustomerSubscriptionView[]>("/api/me/subscriptions");
}

export function getMyProfile(): Promise<CustomerProfileData> {
  return apiGet<CustomerProfileData>("/api/me/profile");
}

export function updateMyProfile(data: UpdateProfileRequest): Promise<CustomerProfileData> {
  return apiPatch<CustomerProfileData>("/api/me/profile", data);
}

export function uploadAvatar(_file: File): Promise<{ avatarUrl: string }> {
  return Promise.resolve({ avatarUrl: "" });
}

export function createCheckout(data: CreateCheckoutRequest): Promise<CheckoutSession> {
  return apiPost<CheckoutSession>("/api/me/checkout", data);
}

export function getCheckoutStatus(sessionId: string): Promise<CheckoutSession> {
  return apiGet<CheckoutSession>(`/api/me/checkout?id=${encodeURIComponent(sessionId)}`);
}

/* ============================================================
 * Licença — Revelar chave (auditado, via BFF)
 * ============================================================ */

export interface RevealLicenseRequest {
  reason: string;
  confirm: boolean;
}

export interface RevealLicenseResponse {
  key: string;
  auditId: string;
}

export type ActivationMode = "account" | "key";

export interface ActivationResult {
  mode: ActivationMode;
  stub?: boolean;
  licenseId: string;
  keyMasked: string | null;
  productId: string | null;
  expiresAt?: string | null;
  graceUntil?: string | null;
  device_hash: string;
  offlineToken: string;
  off_exp?: string | null;
  token_version?: number;
}

export interface ActivateByAccountRequest {
  productId?: string;
  app_instance_id?: string;
  label?: string;
}

export function revealLicense(licenseId: string, data: RevealLicenseRequest): Promise<RevealLicenseResponse> {
  return apiPost<RevealLicenseResponse>(`/api/me/licenses/${encodeURIComponent(licenseId)}/reveal`, data);
}

/**
 * Ativação modo A ("entrar na conta", recomendado): o BFF resolve as licenças
 * do e-mail logado, vincula o dispositivo e devolve o offline-token.
 */
export function activateByAccount(
  data: ActivateByAccountRequest
): Promise<ActivationResult> {
  return apiPost<ActivationResult>("/api/me/licenses/activate", data);
}

/* ============================================================
 * Dispositivos da licença
 * ============================================================ */

export interface DeviceView {
  id: string;
  licenseId: string;
  label: string;
  deviceHashMasked: string;
  lastActivity: string;
  live: boolean;
  suspectClone?: boolean;
}

export function getLicenseDevices(_licenseId: string): Promise<DeviceView[]> {
  return Promise.resolve([]);
}

export function unlinkDevice(_licenseId: string, _deviceId: string): Promise<void> {
  return Promise.resolve();
}

export function blockDevice(_licenseId: string, _deviceId: string, _reason: string): Promise<void> {
  return Promise.resolve();
}
