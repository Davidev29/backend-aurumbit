import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_ME_ADMIN } from "@/lib/mocks";

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
 * BFF `POST /api/auth/mfa/verify {code, ticket?}` — confirma o código TOTP.
 * Aceita ticket SEM sessão (o login com MFA não seta cookies — só o ticket).
 * Real: proxy p/ Nest; em sucesso (LoginResult) seta os cookies de sessão
 * como o login direto. Sem backend (mock): aceita qualquer 6 dígitos.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { code?: string; ticket?: string };
  const session = req.cookies.get(SESSION_COOKIE)?.value;

  if (API_INTERNAL_URL) {
    if (!body.ticket && !session) {
      return NextResponse.json({ code: "UNAUTHORIZED", message: "Não autenticado." }, { status: 401 });
    }
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/auth/mfa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await upstream.json().catch(() => ({}))) as {
      accessToken?: string;
      refreshToken?: string;
      code?: string;
      message?: string;
    };
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    // Sucesso = LoginResult: materializa a sessão (TODO A4: identidade real).
    if (typeof data.accessToken === "string" && data.accessToken) {
      const me = { ...MOCK_ME_ADMIN, mfaRequired: false };
      const res = NextResponse.json({ ok: true, mfaRequired: false, me });
      res.cookies.set(SESSION_COOKIE, data.accessToken, cookieOpts(15 * 60));
      if (typeof data.refreshToken === "string" && data.refreshToken) {
        res.cookies.set(REFRESH_COOKIE, data.refreshToken, { ...cookieOpts(30 * 24 * 3600), path: "/api/auth" });
      }
      res.cookies.set(CLAIMS_COOKIE, JSON.stringify(me.permissions), { ...cookieOpts(), httpOnly: false });
      return res;
    }
    return NextResponse.json(data, { status: upstream.status });
  }

  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Não autenticado." }, { status: 401 });
  }
  if (!body.code || String(body.code).trim().length < 6) {
    return NextResponse.json({ code: "MFA_INVALID_CODE", message: "Informe o código de 6 dígitos." }, { status: 401 });
  }
  return NextResponse.json({ ok: true, mock: true });
}
