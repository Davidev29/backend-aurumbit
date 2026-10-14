import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "aurum_session";
const CLAIMS_COOKIE = "aurum_claims";

/**
 * Frontend-first (dev): `ADMIN_DEV_OPEN=1` libera todas as telas sem exigir
 * sessão/claims — as permissões vêm do mock admin. NUNCA habilitar em produção
 * (sem backend real a autorização é fictícia). TODO(backend pronto): remover.
 */
function isDevOpen(): boolean {
  return process.env.ADMIN_DEV_OPEN === "1";
}

/**
 * Gate de autenticação/autorização (Fase 2 — stub com cookies httpOnly do BFF).
 *
 * - Sem cookie `aurum_session` em rota protegida → redirect `/login`.
 * - Rota `/financeiro*` exige claim `finance.read` (PROJECT §3, default deny
 *   p/ manager) → sem claim → redirect `/forbidden`.
 *
 * TODO(Fase 2+ backend real): validar sessão no Nest (introspecção/assinatura)
 * em vez de confiar no cookie de claims legível; `aurum_claims` hoje é apenas
 * espelho legível p/ gate de UI — a autorização real é sempre do backend (403).
 */
function readClaims(req: NextRequest): string[] {
  const raw = req.cookies.get(CLAIMS_COOKIE)?.value;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

export function middleware(req: NextRequest) {
  if (isDevOpen()) return NextResponse.next();

  const { pathname } = req.nextUrl;

  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/mfa") ||
    pathname.startsWith("/forbidden") ||
    pathname.startsWith("/api/auth/");

  if (isPublic) return NextResponse.next();

  const hasSession = req.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/financeiro") || pathname.startsWith("/notificacoes")) {
    const claims = readClaims(req);
    if (!claims.includes("finance.read")) {
      const url = req.nextUrl.clone();
      url.pathname = "/forbidden";
      return NextResponse.redirect(url);
    }
  }

  // Fase 4: rotas de billing exigem `billing.read` (manager+). Ações
  // cancel/refund exigem ainda `billing.manage` (backend 403 + UI desabilita).
  if (
    pathname.startsWith("/cobrancas") ||
    pathname.startsWith("/assinaturas") ||
    pathname.startsWith("/auditoria")
  ) {
    const claims = readClaims(req);
    if (!claims.includes("billing.read")) {
      const url = req.nextUrl.clone();
      url.pathname = "/forbidden";
      return NextResponse.redirect(url);
    }
  }

  // Fase 6: `/filas` (DLQ replay) é só admin — exige `billing.manage`.
  if (pathname.startsWith("/filas")) {
    const claims = readClaims(req);
    if (!claims.includes("billing.manage")) {
      const url = req.nextUrl.clone();
      url.pathname = "/forbidden";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|apple-touch-icon.png|brand/|icon.svg).*)"],
};
