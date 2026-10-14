import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_ME_CUSTOMER } from "@/lib/mocks";
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

/**
 * BFF `POST /api/auth/register` → Nest `POST /v1/auth/register`.
 * Validação mínima no BFF (UX); validação de negócio é do backend.
 */
export async function POST(req: NextRequest) {
  const __up = resolveUpstream();
  if (__up.kind === "missing") return __up.response;
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    email?: unknown;
    password?: unknown;
    acceptTerms?: unknown;
  };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (name.length < 2) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Nome deve ter ao menos 2 caracteres." },
      { status: 422 }
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "E-mail inválido." },
      { status: 422 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Senha deve ter ao menos 8 caracteres." },
      { status: 422 }
    );
  }

  if (API_INTERNAL_URL) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await upstream.json().catch(() => ({}))) as {
        accessToken?: string;
        refreshToken?: string;
      };
      if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });
      const me = { ...MOCK_ME_CUSTOMER, email, name };
      const res = NextResponse.json({ ok: true, mfaRequired: false, me }, { status: 201 });
      if (typeof data.accessToken === "string" && data.accessToken) {
        res.cookies.set(SESSION_COOKIE, data.accessToken, cookieOpts(15 * 60));
      } else {
        res.cookies.set(SESSION_COOKIE, `stub-portal-session-${Date.now()}`, cookieOpts());
      }
      if (typeof data.refreshToken === "string" && data.refreshToken) {
        res.cookies.set(REFRESH_COOKIE, data.refreshToken, { ...cookieOpts(30 * 24 * 3600), path: "/api/auth" });
      }
      return res;
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
        { status: 502 }
      );
    }
  }

  if (email === "usado@aurum.test") {
    return NextResponse.json(
      { code: "CONFLICT", message: "E-mail já cadastrado." },
      { status: 409 }
    );
  }

  const me = { ...MOCK_ME_CUSTOMER, email, name };
  const res = NextResponse.json({ ok: true, mfaRequired: false, me }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, `stub-portal-session-${Date.now()}`, cookieOpts());
  return res;
}
