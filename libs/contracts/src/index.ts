/**
 * Contratos HTTP v1 — Fase 1, sem negócio.
 * Regras de evolução (forward-compatible, PROJECT/REQUIREMENTS):
 * - Produtores SÓ adicionam campos opcionais; nunca renomeiam/removem/estreitam.
 * - Consumidores (incl. admin Next) DEVEM ignorar campos desconhecidos.
 * - `/v1` prefixado; erros seguem `ApiError`; listas usam cursor.
 */

export const API_VERSION = "v1" as const;
export const IDEMPOTENCY_HEADER = "Idempotency-Key" as const;
export const CORRELATION_HEADER = "x-correlation-id" as const;

/** Erro padronizado (RFC-7807 simplificado). `code` é estável e documentado; `details` nunca tem PII. */
export interface ApiError {
  code: string;
  message: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

/** Códigos de erro estáveis Fase 1 (domínios futuros estendem, nunca renomeiam). */
export const ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "UNPROCESSABLE",
  "RATE_LIMITED",
  "INTERNAL",
  "SERVICE_UNAVAILABLE",
  // Fases 2-4 (reservados, forward-compatible):
  "EXPIRED",
  "OFFLINE_EXPIRED",
  "LICENSE_DEGRADED",
  // Fase 2 (guards + shared): limite de máquinas (REQUIREMENTS §2).
  "DEVICE_LIMIT",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Paginação por cursor (admin usa cursor; nunca offset global). */
export interface PageMeta {
  nextCursor: string | null;
  limit: number;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export function emptyPage<T>(limit: number): Page<T> {
  return { data: [], meta: { nextCursor: null, limit } };
}

/** Health (espelha libs/observability health.ts — contrato público do smoke CI/CD). */
export interface LiveResponse {
  status: "ok";
}

export interface ReadyResponse {
  status: "ok" | "degraded";
  postgres: "up" | "down";
  redis: "up" | "down";
}

/** Chave de licença mascarada (PROJECT §2: API/UI nunca expõem plaintext). */
export interface LicenseKeyView {
  keyMasked: string;
  keyPrefix: string;
  keyLast4: string;
}

export function isApiError(v: unknown): v is ApiError {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.code === "string" && typeof o.message === "string";
}

// Fase 2 — DTOs zod por domínio (contrato HTTP v1 público).
export * from "./auth";
export * from "./customers";
export * from "./products";
export * from "./access";
