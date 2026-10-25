/**
 * Headers de upstream p/ o Nest real (`API_INTERNAL_URL`).
 * Guards stub do backend exigem `x-role: admin` nas escritas administrativas
 * (products/admin.guard, access/admin.guard, LicensesController).
 *
 * Modo misto por domínio (frontend-first honesto): o financeiro segue em stub
 * (membership RBAC pendente — Fase 2-auth) com dados de demonstração
 * sinalizados na UI. Quando pronto, define-se `API_FINANCE_URL`
 * (billing já é real via global).
 */
import { NextResponse } from "next/server";

/** URL do Nest por domínio (indefinida = stub de demonstração). */
export function apiUrlFor(domain: "billing" | "finance"): string | undefined {
  if (domain === "billing") return process.env.API_BILLING_URL || process.env.API_INTERNAL_URL || undefined;
  return process.env.API_FINANCE_URL || process.env.API_INTERNAL_URL || undefined;
}

/**
 * Resposta 502 fail-closed: sem `API_*_URL` configurado o BFF nunca serve
 * mock/stub em produção. Retorna null quando há upstream (segue o fluxo
 * normal) ou a resposta de erro quando não há.
 */
export function upstreamRequiredOr502(domain?: "billing" | "finance"): NextResponse | null {
  const hasUpstream = domain ? apiUrlFor(domain) : (apiUrlFor("billing") || apiUrlFor("finance"));
  if (hasUpstream) return null;
  return NextResponse.json(
    { code: "UPSTREAM_MISSING", message: "Nenhum upstream de backend configurado. Operação indisponível sem API real." },
    { status: 502 },
  );
}

/**
 * Exige `x-org-id` (financeiro é org-scoped). Retorna 400 quando ausente ou
 * inválido (vazio/whitespace), null quando válido e segue o fluxo normal.
 */
export function requireOrgId(orgId: string | null | undefined): NextResponse | null {
  if (!orgId || orgId.trim().length === 0) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "x-org-id é obrigatório." }, { status: 400 });
  }
  return null;
}

export function upstreamHeaders(session?: string): Record<string, string> {
  return {
    "x-role": "admin",
    ...(session ? { Cookie: `aurum_session=${session}` } : {}),
  };
}

export function upstreamJsonHeaders(session?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...upstreamHeaders(session),
  };
}

/**
 * Autorização p/ a cadeia global do Nest (JwtAuthGuard 401 sem Bearer).
 * Em modo real a sessão É o access JWT; em stub não há upstream — o header
 * é inócuo (nunca enviado sem `API_INTERNAL_URL`).
 * `withRole: false` omite `x-role: admin` (p/ guards que tratam admin de
 * forma especial, ex. reveal com step-up MFA).
 */
export function upstreamAuthHeaders(
  session?: string,
  opts?: { withRole?: boolean },
): Record<string, string> {
  const withRole = opts?.withRole !== false;
  return {
    ...(withRole ? { "x-role": "admin" } : {}),
    ...(session ? { Cookie: `aurum_session=${session}` } : {}),
    ...(session && !session.startsWith("stub-session-")
      ? { Authorization: `Bearer ${session}` }
      : {}),
  };
}

export function upstreamAuthJsonHeaders(session?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...upstreamAuthHeaders(session),
  };
}
