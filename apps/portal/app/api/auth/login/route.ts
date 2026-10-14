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
 * BFF `POST /api/auth/login` → Nest `POST /v1/auth/login`.
 * Sessão em cookies httpOnly (nunca expõe JWT ao JS).
 */
export async function POST(req: NextRequest) {
  // Fase 8 (carry Fase 7): prod sem upstream → 502, nunca stub silencioso.
  const __up = resolveUpstream();
  if (__up.kind === "missing") return __up.response;
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = typeof body.email === "string" ? body.email : "";

  if (API_INTERNAL_URL) {
    try {
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
      };
      if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });
      if (data.mfaRequired === true) {
        return NextResponse.json({ ok: false, mfaRequired: true, mfaTicket: data.mfaTicket });
      }
      if (typeof data.accessToken !== "string" || !data.accessToken) {
        return NextResponse.json(
          { code: "UPSTREAM_UNAVAILABLE", message: "Login sem token — tente novamente." },
          { status: 502 }
        );
      }
      const me = { ...MOCK_ME_CUSTOMER, email: email || MOCK_ME_CUSTOMER.email, mfaRequired: false };
      const res = NextResponse.json({ ok: true, mfaRequired: false, me });
      res.cookies.set(SESSION_COOKIE, data.accessToken, cookieOpts(15 * 60));
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

  if (!email || !body.password) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Informe e-mail e senha." },
      { status: 400 }
    );
  }

  // Stub: qualquer senha ≥ 1 aceita; e-mail vira identidade.
  if (body.password === "errada") {
    return NextResponse.json(
      { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." },
      { status: 401 }
    );
  }
  const me = { ...MOCK_ME_CUSTOMER, email };
  const res = NextResponse.json({ ok: true, mfaRequired: false, me });
  res.cookies.set(SESSION_COOKIE, `stub-portal-session-${me.id}`, cookieOpts());
  return res;
}
