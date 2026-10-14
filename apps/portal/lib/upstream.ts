import { NextResponse } from "next/server";

/**
 * Guarda fail-closed do BFF → upstream Nest.
 *
 * Regra T0: em `NODE_ENV=production`, `API_INTERNAL_URL` ausente/vazio NUNCA
 * cai em mock silencioso — o BFF responde `502 {code:"UPSTREAM_MISSING"}`.
 * Fora de produção, a ausência libera os stubs locais (dev/preview sem backend).
 */

/** Erro tipado: base do upstream ausente ou vazia. */
export class UpstreamMissingError extends Error {
  readonly code = "UPSTREAM_MISSING" as const;

  constructor() {
    super("API_INTERNAL_URL não configurada: backend indisponível.");
    this.name = "UpstreamMissingError";
  }
}

/** Erro tipado: upstream respondeu com status de erro (corpo preservado). */
export class UpstreamStatusError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Upstream respondeu ${status}.`);
    this.name = "UpstreamStatusError";
    this.status = status;
    this.body = body;
  }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Base do upstream com trim. `""` = ausente. Nunca lança. */
export function getUpstreamBase(): string {
  return (process.env.API_INTERNAL_URL ?? "").trim();
}

/** Mock/stub local só é permitido fora de produção. */
export function isMockAllowed(): boolean {
  return !isProduction();
}

/** Devolve a base ou lança `UpstreamMissingError`. */
export function requireUpstream(): string {
  const base = getUpstreamBase();
  if (!base) throw new UpstreamMissingError();
  return base;
}

export function isUpstreamMissingError(err: unknown): err is UpstreamMissingError {
  return err instanceof UpstreamMissingError;
}

const UPSTREAM_MISSING_MESSAGE =
  "Backend indisponível (API_INTERNAL_URL não configurada). Tente novamente.";

/** Resposta 502 visível para ausência de upstream em produção. */
export function upstreamMissingResponse(): NextResponse {
  return NextResponse.json(
    { code: "UPSTREAM_MISSING", message: UPSTREAM_MISSING_MESSAGE },
    { status: 502 }
  );
}

export type UpstreamResolution =
  | { readonly kind: "upstream"; readonly base: string }
  | { readonly kind: "mock" }
  | { readonly kind: "missing"; readonly response: NextResponse };

/**
 * Resolução única para handlers BFF:
 * - `upstream` → chamar o Nest em `base`;
 * - `mock` → stub local (dev apenas);
 * - `missing` → retornar `response` (502 fail-closed, prod sem upstream).
 */
export function resolveUpstream(): UpstreamResolution {
  try {
    return { kind: "upstream", base: requireUpstream() };
  } catch (err) {
    if (!isUpstreamMissingError(err)) throw err;
    if (isMockAllowed()) return { kind: "mock" };
    return { kind: "missing", response: upstreamMissingResponse() };
  }
}

/** 502 visível para upstream inalcançável (comportamento já existente). */
export function upstreamUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
    { status: 502 }
  );
}
