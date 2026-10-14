import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const SESSION_COOKIE = "aurum_session";
const REFRESH_COOKIE = "ab_refresh";
const CLAIMS_COOKIE = "aurum_claims";

function cookieOpts(maxAge?: number) {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAge ?? 60 * 60 * 8,
  };
}

/**
 * BFF `POST /api/auth/refresh` — rotação de sessão.
 * Real: lê `ab_refresh` (httpOnly) e envia NO BODY (evita o CSRF check
 * same-origin do Nest, feito só p/ cookie) → rotaciona os 3 cookies.
 * `REUSE_DETECTED`/`TOKEN_EXPIRED`/`INVALID_TOKEN` → limpa tudo (401, login).
 * TODO(backend pronto): remover ramo mock.
 */
export async function POST(req: NextRequest) {
  const session = req.cookies.get(SESSION_COOKIE)?.value;

  if (API_INTERNAL_URL) {
    const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value ?? "";
    if (!refreshToken) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: "Sessão ausente." },
        { status: 401 },
      );
    }
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      const data = (await upstream.json().catch(() => ({}))) as {
        accessToken?: string;
        refreshToken?: string;
        code?: string;
      };
      if (!upstream.ok || typeof data.accessToken !== "string") {
        const res = NextResponse.json(data, { status: upstream.status });
        res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
        res.cookies.set(REFRESH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
        res.cookies.set(CLAIMS_COOKIE, "", { path: "/", maxAge: 0 });
        return res;
      }
      const res = NextResponse.json({ ok: true });
      res.cookies.set(SESSION_COOKIE, data.accessToken, cookieOpts(15 * 60));
      if (typeof data.refreshToken === "string" && data.refreshToken) {
        res.cookies.set(REFRESH_COOKIE, data.refreshToken, { ...cookieOpts(30 * 24 * 3600), path: "/api/auth" });
      }
      return res;
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
  }

  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Sessão ausente." }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
