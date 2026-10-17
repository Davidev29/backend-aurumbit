import type { MeResponse } from "@/types";

/**
 * Ponte BFF → domínio `auth` do Nest.
 *
 * Fonte da verdade da sessão é `GET /v1/auth/me` (JWT real). O BFF **nunca**
 * inventa identidade quando o upstream está configurado: sem payload válido,
 * `GET /api/auth/me` responde 401 (antes devolvia um mock "logado" para
 * qualquer cookie `stub-*`, o que deixava a área do cliente mentindo).
 */

/** Identidade crua de `GET /v1/auth/me`. */
export interface UpstreamIdentity {
  identityId: string;
  email: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  createdAt: string;
}

export interface UpstreamRefresh {
  accessToken: string;
  refreshToken?: string;
}

/** Lê a identidade do titular com o access token atual. */
export async function fetchUpstreamIdentity(
  base: string,
  accessToken: string
): Promise<{ status: number; identity: UpstreamIdentity | null }> {
  const res = await fetch(`${base}/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return { status: res.status, identity: null };
  const data = (await res.json().catch(() => null)) as UpstreamIdentity | null;
  if (!data || typeof data.identityId !== "string" || typeof data.email !== "string") {
    return { status: 502, identity: null };
  }
  return { status: res.status, identity: data };
}

/**
 * Converte a identidade do `auth` para o shape da área do cliente.
 * O domínio `auth` NÃO guarda nome (quem guarda é o perfil em `customers`),
 * então usamos a parte local do e-mail como rótulo de exibição — o perfil
 * substitui quando preenchido, em vez de mostrar um nome fictício.
 */
export function toMeResponse(identity: UpstreamIdentity): MeResponse {
  const label = identity.email.split("@")[0] ?? "";
  return {
    id: identity.identityId,
    email: identity.email,
    name: label,
    displayName: label,
    mfaRequired: false,
    // `mfaEnabled` = TOTP ativo e verificado no domínio auth.
    mfaVerified: identity.mfaEnabled === true,
    permissions: [],
    createdAt: identity.createdAt,
  };
}

/**
 * 1 rotação do refresh (OAuth 2.0 Security BCP, rotação com detecção de reuso
 * no backend). Devolve `null` quando o par não pode ser rotacionado — o
 * chamador decide se limpa a sessão.
 */
export async function rotateUpstreamRefresh(
  base: string,
  refreshToken: string
): Promise<UpstreamRefresh | null> {
  const res = await fetch(`${base}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Partial<UpstreamRefresh>;
  if (!res.ok || typeof data.accessToken !== "string" || !data.accessToken) return null;
  return { accessToken: data.accessToken, refreshToken: data.refreshToken };
}
