import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_ME_CUSTOMER } from "@/lib/mocks";
import { cookieContext, setAuthCookies } from "@/lib/session";
import { resolveUpstream } from "@/lib/upstream";

/**
 * Versão dos consentimentos aceitos neste cadastro (LGPD art. 8º).
 * O Nest exige `consents[]` com `{type: "TERMS"|"PRIVACY", version}` ≥ 1 char.
 */
const CONSENT_VERSION = "v1";

function unprocessable(code: string, message: string) {
  return NextResponse.json({ code, message }, { status: 422 });
}

/**
 * BFF `POST /api/auth/register` → Nest `POST /v1/auth/register`.
 *
 * O formulário do portal (name/confirmPassword/acceptTerms) **não** é o
 * contrato do Nest: `RegisterDto` aceita exatamente
 * `{email, password, consents[], deviceLabel?}` e o `ValidationPipe` global
 * roda com `forbidNonWhitelisted` — qualquer campo extra vira 400. Aqui o
 * payload é traduzido (checkbox de termos → `consents` versionados) e
 * `name`/`confirmPassword`/`acceptTerms` NUNCA seguem para o upstream.
 *
 * Cadastro NÃO abre sessão: a identidade nasce `PENDING_VERIFICATION` e o
 * login só libera após o `verify-email` (403 `EMAIL_NOT_VERIFIED`). Quem abre
 * sessão é o login — antes desta correção o BFF gravava um cookie `stub-*`
 * mesmo com upstream, criando sessão fantasma que o backend não conhecia.
 */
export async function POST(req: NextRequest) {
  const up = resolveUpstream();
  if (up.kind === "missing") return up.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const acceptTerms = body.acceptTerms === true;

  // Validação de UX no BFF (a de negócio continua sendo do backend).
  if (name.length < 2) return unprocessable("UNPROCESSABLE", "Nome deve ter ao menos 2 caracteres.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return unprocessable("UNPROCESSABLE", "E-mail inválido.");
  }
  if (password.length < 8) {
    return unprocessable("UNPROCESSABLE", "Senha deve ter ao menos 8 caracteres.");
  }
  if (!acceptTerms) {
    return unprocessable(
      "CONSENTS_REQUIRED",
      "Aceite os Termos de Uso e a Política de Privacidade para criar a conta."
    );
  }

  if (up.kind === "upstream") {
    try {
      const upstream = await fetch(`${up.base}/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          consents: [
            { type: "TERMS", version: CONSENT_VERSION },
            { type: "PRIVACY", version: CONSENT_VERSION },
          ],
          deviceLabel: "portal-web",
        }),
      });
      const data = await upstream.json().catch(() => ({}));
      // 400/409/429 do backend sobem com código e mensagem originais.
      if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });
      // 201: identidade criada aguardando confirmação de e-mail. Sem sessão.
      return NextResponse.json(
        { ok: true, mfaRequired: false, verificationRequired: true, email },
        { status: 201 }
      );
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
        { status: 502 }
      );
    }
  }

  // Stub dev-only (sem upstream, nunca em prod): mantém a área do cliente
  // navegável sem backend. Sem upstream não existe verificação de e-mail, então
  // a sessão local é criada na hora — comportamento exclusivo deste modo.
  if (email === "usado@aurum.test") {
    return NextResponse.json({ code: "CONFLICT", message: "E-mail já cadastrado." }, { status: 409 });
  }

  const me = { ...MOCK_ME_CUSTOMER, email, name };
  const res = NextResponse.json(
    { ok: true, mfaRequired: false, verificationRequired: false, me },
    { status: 201 }
  );
  setAuthCookies(res, { accessToken: `stub-portal-session-${Date.now()}` }, cookieContext(req));
  return res;
}
