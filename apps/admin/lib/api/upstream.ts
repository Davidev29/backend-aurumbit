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

/** URL do Nest por domínio (indefinida = stub de demonstração). */
export function apiUrlFor(domain: "billing" | "finance"): string | undefined {
  if (domain === "billing") return process.env.API_BILLING_URL || undefined;
  return process.env.API_FINANCE_URL || undefined;
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
