import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_ME_CUSTOMER } from "@/lib/mocks";
import { fetchUpstreamIdentity, toMeResponse } from "@/lib/auth-upstream";
import { cookieContext, setAuthCookies } from "@/lib/session";
import { resolveUpstream } from "@/lib/upstream";

/**
 * BFF `POST /api/auth/login` → Nest `POST /v1/auth/login`.
 *
 * - `rememberMe` é do formulário, NÃO do Nest (`forbidNonWhitelisted` → 400):
 *   vira apenas a duração dos cookies (lembrado = persiste; senão = cookie de
 *   sessão do navegador) e nunca segue no corpo.
 * - Sessão em cookies httpOnly (JWT nunca exposto ao JS).
 * - Erros do backend (401 `INVALID_CREDENTIALS`, 403 `EMAIL_NOT_VERIFIED`,
 *   423 `ACCOUNT_LOCKED`, 429 `RATE_LIMITED`) sobem com código original para
 *   a UI explicar o que fazer em vez de "credenciais inválidas" genérico.
 */
export async function POST(req: NextRequest) {
  const up = resolveUpstream();
  if (up.kind === "missing") return up.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const remember = body.rememberMe !== false;
  const ctx = cookieContext(req);

  if (!email || !password) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Informe e-mail e senha." },
      { status: 400 }
    );
  }

  if (up.kind === "upstream") {
    try {
      const upstream = await fetch(`${up.base}/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, deviceLabel: "portal-web" }),
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
      // Identidade real (best-effort): quando o `/v1/auth/me` responde, o
      // cliente já entra com o titular certo em vez de um nome fictício.
      const identity = await fetchUpstreamIdentity(up.base, data.accessToken).catch(() => null);
      const me = identity?.identity ? toMeResponse(identity.identity) : undefined;

      const res = NextResponse.json({
        ok: true,
        mfaRequired: false,
        ...(me ? { me } : {}),
      });
      setAuthCookies(
        res,
        { accessToken: data.accessToken, refreshToken: data.refreshToken, remember },
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

  // Stub dev-only (sem upstream, nunca em prod): qualquer senha ≥ 1 é aceita;
  // e-mail vira identidade. `errada` simula credencial inválida.
  if (password === "errada") {
    return NextResponse.json(
      { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas." },
      { status: 401 }
    );
  }
  const me = { ...MOCK_ME_CUSTOMER, email };
  const res = NextResponse.json({ ok: true, mfaRequired: false, me });
  setAuthCookies(
    res,
    { accessToken: `stub-portal-session-${me.id}`, remember },
    ctx
  );
  return res;
}
