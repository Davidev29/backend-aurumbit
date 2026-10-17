import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_ME_CUSTOMER } from "@/lib/mocks";
import { fetchUpstreamIdentity, rotateUpstreamRefresh, toMeResponse } from "@/lib/auth-upstream";
import {
  clearAuthCookies,
  cookieContext,
  isStubSession,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  setAuthCookies,
} from "@/lib/session";
import { resolveUpstream } from "@/lib/upstream";

/**
 * BFF `GET /api/auth/me` — identidade do cliente logado.
 *
 * Modo upstream: a identidade vem de `GET /v1/auth/me` (JWT real). Se o access
 * expirou (401), tenta **1** rotação via refresh e repete; falhou, limpa os
 * cookies e responde 401. Sessão `stub-*` (fantasma de versão antiga do BFF)
 * conta como não autenticada — nunca mais "mock logado" com backend no ar.
 *
 * Modo stub (sem upstream, dev-only): espelha a sessão local.
 *
 * Sem sessão alguma já é 401 — é o resultado esperado para visitante; quem
 * evita a chamada nesse caso é o cliente (cookie-dica `aurum_portal_session_hint`).
 */
export async function GET(req: NextRequest) {
  const up = resolveUpstream();
  if (up.kind === "missing") return up.response;

  const ctx = cookieContext(req);
  const session = req.cookies.get(SESSION_COOKIE)?.value;

  if (up.kind === "upstream") {
    if (!session || isStubSession(session)) {
      const res = NextResponse.json(
        { code: "UNAUTHORIZED", message: "Não autenticado." },
        { status: 401 }
      );
      if (session) clearAuthCookies(res, ctx);
      return res;
    }

    try {
      const first = await fetchUpstreamIdentity(up.base, session);
      if (first.status === 200 && first.identity) {
        return NextResponse.json(toMeResponse(first.identity));
      }
      if (first.status !== 401 && first.status !== 403) {
        return NextResponse.json(
          { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
          { status: 502 }
        );
      }

      // Access expirado/recusado: 1 rotação com o refresh httpOnly.
      const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
      if (refresh) {
        const rotated = await rotateUpstreamRefresh(up.base, refresh);
        if (rotated) {
          const retry = await fetchUpstreamIdentity(up.base, rotated.accessToken);
          if (retry.status === 200 && retry.identity) {
            const res = NextResponse.json(toMeResponse(retry.identity));
            // Rotação re-persiste o par (a duração original do cookie não é
            // legível na requisição).
            setAuthCookies(
              res,
              { accessToken: rotated.accessToken, refreshToken: rotated.refreshToken },
              ctx
            );
            return res;
          }
        }
      }

      const res = NextResponse.json(
        { code: "REVOKED", message: "Sessão expirada. Entre de novo." },
        { status: 401 }
      );
      clearAuthCookies(res, ctx);
      return res;
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
        { status: 502 }
      );
    }
  }

  // ── Modo stub (dev sem backend) ──────────────────────────────────────────
  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Não autenticado." },
      { status: 401 }
    );
  }
  return NextResponse.json(MOCK_ME_CUSTOMER);
}
