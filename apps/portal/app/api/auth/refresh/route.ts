import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rotateUpstreamRefresh } from "@/lib/auth-upstream";
import {
  clearAuthCookies,
  cookieContext,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  setAuthCookies,
} from "@/lib/session";
import { resolveUpstream } from "@/lib/upstream";

/**
 * BFF `POST /api/auth/refresh` — rotação do par sessão/refresh.
 * Lê `aurum_portal_refresh` (httpOnly, nunca exposto ao JS) e troca por um par
 * novo no upstream. Falha → limpa os cookies + 401 (o cliente reabre o login).
 */
export async function POST(req: NextRequest) {
  const up = resolveUpstream();
  if (up.kind === "missing") return up.response;

  const ctx = cookieContext(req);
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;

  if (up.kind === "upstream") {
    if (!refresh) {
      const res = NextResponse.json(
        { code: "REVOKED", message: "Sessão expirada. Entre de novo." },
        { status: 401 }
      );
      clearAuthCookies(res, ctx);
      return res;
    }
    try {
      const rotated = await rotateUpstreamRefresh(up.base, refresh);
      if (!rotated) {
        const res = NextResponse.json(
          { code: "REVOKED", message: "Sessão expirada. Entre de novo." },
          { status: 401 }
        );
        clearAuthCookies(res, ctx);
        return res;
      }
      const res = NextResponse.json({ ok: true });
      setAuthCookies(
        res,
        { accessToken: rotated.accessToken, refreshToken: rotated.refreshToken },
        ctx
      );
      return res;
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
        { status: 502 }
      );
    }
  }

  // Stub (sem backend): sessão local não expira — nada a rotacionar.
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (session) {
    return NextResponse.json({ ok: true, stub: true });
  }

  const res = NextResponse.json(
    { code: "REVOKED", message: "Sessão expirada. Entre de novo." },
    { status: 401 }
  );
  clearAuthCookies(res, ctx);
  return res;
}
