import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Cookies de sessão do Portal (BFF) — nomes, TTLs e flags em UM lugar.
 *
 * - `aurum_portal_session`: access JWT (15min), httpOnly, nunca exposto ao JS.
 * - `aurum_portal_refresh`: refresh opaco (30d), httpOnly, escopo `/api/auth`.
 * - `aurum_portal_session_hint`: NÃO httpOnly, sem token, só diz "existe
 *   sessão". O cliente usa para não chamar `GET /api/auth/me` quando está
 *   deslogado (era isso que gerava 401 no console da landpage a cada visita).
 *
 * Flag `Secure` é decidida pelo PROTOCOLO da requisição (x-forwarded-proto),
 * não por `NODE_ENV`: o stack dev roda build de produção atrás de HTTP em
 * `localhost` e cookie `Secure` sobre HTTP é descartado pelo navegador.
 */

export const SESSION_COOKIE = "aurum_portal_session";
export const REFRESH_COOKIE = "aurum_portal_refresh";
export const HINT_COOKIE = "aurum_portal_session_hint";

/** TTL do access no backend (AuthService.accessTtlSec = 900s). */
export const ACCESS_TTL_SEC = 15 * 60;
/** TTL do refresh no backend (REFRESH_TTL_MS = 30d). */
export const REFRESH_TTL_SEC = 30 * 24 * 3600;

export interface CookieContext {
  /** `Secure` = requisição veio por HTTPS (ou o navegador está em localhost). */
  readonly secure: boolean;
}

/** Contexto de cookie derivado do protocolo real da requisição. */
export function cookieContext(req: NextRequest): CookieContext {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded) return { secure: forwarded.split(",")[0]!.trim() === "https" };
  return { secure: req.nextUrl.protocol === "https:" };
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken?: string | null;
  /** `false` → cookie de sessão do navegador (some ao fechar); default `true`. */
  readonly remember?: boolean;
}

/** Grava o par de sessão + dica de sessão (login/refresh). */
export function setAuthCookies(res: NextResponse, tokens: AuthTokens, ctx: CookieContext): void {
  const remember = tokens.remember !== false;

  res.cookies.set(SESSION_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure: ctx.secure,
    sameSite: "lax",
    path: "/",
    ...(remember ? { maxAge: ACCESS_TTL_SEC } : {}),
  });

  if (typeof tokens.refreshToken === "string" && tokens.refreshToken) {
    res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: ctx.secure,
      sameSite: "lax",
      path: "/api/auth",
      ...(remember ? { maxAge: REFRESH_TTL_SEC } : {}),
    });
  }

  // Dica de sessão: sem token, só o booleano que o cliente lê (não httpOnly).
  res.cookies.set(HINT_COOKIE, "1", {
    httpOnly: false,
    secure: ctx.secure,
    sameSite: "lax",
    path: "/",
    ...(remember ? { maxAge: REFRESH_TTL_SEC } : {}),
  });
}

/** Limpa sessão, refresh e dica (logout, 401 definitivo, refresh revogado). */
export function clearAuthCookies(res: NextResponse, ctx: CookieContext): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: ctx.secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  res.cookies.set(REFRESH_COOKIE, "", {
    httpOnly: true,
    secure: ctx.secure,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 0,
  });
  res.cookies.set(HINT_COOKIE, "", {
    httpOnly: false,
    secure: ctx.secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Sessão stub (`stub-*`): só existe em dev sem upstream. Em modo upstream um
 * valor desses é cookie fantasma (cadastro antigo que abria sessão sem o
 * backend saber) — vale como "não autenticado".
 */
export function isStubSession(value: string | undefined): boolean {
  return typeof value === "string" && value.startsWith("stub-");
}
