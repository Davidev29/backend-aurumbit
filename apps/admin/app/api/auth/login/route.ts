import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_ME_ADMIN, MOCK_ME_MANAGER } from "@/lib/mocks";

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
 * BFF `POST /api/auth/login` — proxy p/ Nest `POST /v1/auth/login`.
 * Sessão em cookies httpOnly (nunca expõe token ao JS).
 *
 * TODO(backend pronto): remover ramo mock (sem `API_INTERNAL_URL`) e exigir
 * resposta real do Nest com `Set-Cookie` próprio + claims assinadas.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = typeof body.email === "string" ? body.email : "";

  if (API_INTERNAL_URL) {
    // Real: usa o `mfaRequired` DO UPSTREAM (o mock local sempre diria true).
    // Sessão real = access JWT em `aurum_session` (15min) + refresh em
    // `ab_refresh` (30d, path `/api/auth`); claims seguem espelho legível
    // (TODO A4: `GET /v1/auth/me` + identidade real).
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await upstream.json().catch(() => ({}))) as {
      mfaRequired?: boolean;
      mfaTicket?: string;
      accessToken?: string;
      refreshToken?: string;
      expiresIn?: number;
    };
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    if (data.mfaRequired === true) {
      return NextResponse.json({ ok: false, mfaRequired: true, mfaTicket: data.mfaTicket });
    }
    if (typeof data.accessToken !== "string" || !data.accessToken) {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Login sem token — tente novamente." },
        { status: 502 },
      );
    }
    const me = { ...MOCK_ME_ADMIN, email: email || MOCK_ME_ADMIN.email, mfaRequired: false };
    const res = NextResponse.json({ ok: true, mfaRequired: false, me });
    res.cookies.set(SESSION_COOKIE, data.accessToken, cookieOpts(15 * 60));
    if (typeof data.refreshToken === "string" && data.refreshToken) {
      res.cookies.set(REFRESH_COOKIE, data.refreshToken, { ...cookieOpts(30 * 24 * 3600), path: "/api/auth" });
    }
    res.cookies.set(CLAIMS_COOKIE, JSON.stringify(me.permissions), { ...cookieOpts(), httpOnly: false });
    return res;
  } else if (!email || !body.password) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Informe e-mail e senha." },
      { status: 400 },
    );
  }

  // Stub (sem `API_INTERNAL_URL`): manager@aurum.test simula usuário SEM
  // `finance.read` (PROJECT §3). Modo real retorna mais acima.
  const me = email === "manager@aurum.test" ? MOCK_ME_MANAGER : MOCK_ME_ADMIN;
  const res = NextResponse.json({ ok: true, mfaRequired: me.mfaRequired, me });
  res.cookies.set(SESSION_COOKIE, `stub-session-${me.id}`, cookieOpts());
  res.cookies.set(CLAIMS_COOKIE, JSON.stringify(me.permissions), { ...cookieOpts(), httpOnly: false });
  return res;
}
