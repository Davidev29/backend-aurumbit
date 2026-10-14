import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveUpstream } from "@/lib/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const SESSION_COOKIE = "aurum_portal_session";
const REFRESH_COOKIE = "aurum_portal_refresh";

function cookieOpts(maxAge?: number) {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAge ?? 60 * 60 * 8,
  };
}

function clearAuth(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOpts(0) });
  res.cookies.set(REFRESH_COOKIE, "", { ...cookieOpts(0), path: "/api/auth" });
}

/**
 * BFF `POST /api/auth/refresh` — rotação do par sessão/refresh.
 * Lê `aurum_portal_refresh` (httpOnly, nunca exposto ao JS) e troca por
 * um par novo no upstream. Falha → limpa os 2 cookies + 401.
 */
export async function POST(req: NextRequest) {
  const __up = resolveUpstream();
  if (__up.kind === "missing") return __up.response;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;

  if (API_INTERNAL_URL && refresh) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      const data = (await upstream.json().catch(() => ({}))) as {
        accessToken?: string;
        refreshToken?: string;
      };
      if (!upstream.ok || typeof data.accessToken !== "string" || !data.accessToken) {
        const res = NextResponse.json(
          { code: "REVOKED", message: "Sessão expirada. Entre de novo." },
          { status: 401 }
        );
        clearAuth(res);
        return res;
      }
      const res = NextResponse.json({ ok: true });
      res.cookies.set(SESSION_COOKIE, data.accessToken, cookieOpts(15 * 60));
      if (typeof data.refreshToken === "string" && data.refreshToken) {
        res.cookies.set(REFRESH_COOKIE, data.refreshToken, {
          ...cookieOpts(30 * 24 * 3600),
          path: "/api/auth",
        });
      }
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
  if (!API_INTERNAL_URL && session) {
    return NextResponse.json({ ok: true, stub: true });
  }

  const res = NextResponse.json(
    { code: "REVOKED", message: "Sessão expirada. Entre de novo." },
    { status: 401 }
  );
  clearAuth(res);
  return res;
}
