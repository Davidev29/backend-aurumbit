import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_ME_CUSTOMER } from "@/lib/mocks";
import { resolveUpstream } from "@/lib/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const SESSION_COOKIE = "aurum_portal_session";
const REFRESH_COOKIE = "aurum_portal_refresh";

/** Tenta 1 rotação via `/api/auth/refresh` e repete o GET de identidade. */
async function fetchMeUpstream(session: string): Promise<{ data: unknown; status: number }> {
  const upstream = await fetch(`${API_INTERNAL_URL}/v1/customers/me`, {
    headers: { Authorization: `Bearer ${session}` },
  });
  const data = await upstream.json().catch(() => ({}));
  return { data, status: upstream.status };
}

/**
 * BFF `GET /api/auth/me` — identidade do cliente logado.
 * Proxy p/ Nest quando configurado; se o access expirou (401), tenta 1 rotação
 * e repete antes de devolver 401. Stub espelha sessão local senão.
 */
export async function GET(req: NextRequest) {
  const __up = resolveUpstream();
  if (__up.kind === "missing") return __up.response;
  const session = req.cookies.get(SESSION_COOKIE)?.value;

  if (API_INTERNAL_URL && session && !session.startsWith("stub-")) {
    try {
      const first = await fetchMeUpstream(session);
      if (first.status !== 401) {
        return NextResponse.json(first.data, { status: first.status });
      }
      // Access expirado: 1 rotação com o refresh httpOnly.
      const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
      if (refresh) {
        const rotated = await fetch(`${API_INTERNAL_URL}/v1/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: refresh }),
        });
        const rotatedData = (await rotated.json().catch(() => ({}))) as {
          accessToken?: string;
          refreshToken?: string;
        };
        if (rotated.ok && typeof rotatedData.accessToken === "string" && rotatedData.accessToken) {
          const retry = await fetchMeUpstream(rotatedData.accessToken);
          const res = NextResponse.json(retry.data, { status: retry.status });
          res.cookies.set(SESSION_COOKIE, rotatedData.accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            maxAge: 15 * 60,
          });
          if (typeof rotatedData.refreshToken === "string" && rotatedData.refreshToken) {
            res.cookies.set(REFRESH_COOKIE, rotatedData.refreshToken, {
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: "lax",
              path: "/api/auth",
              maxAge: 30 * 24 * 3600,
            });
          }
          return res;
        }
      }
      return NextResponse.json(
        { code: "REVOKED", message: "Sessão expirada. Entre de novo." },
        { status: 401 }
      );
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
        { status: 502 }
      );
    }
  }

  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Não autenticado." },
      { status: 401 }
    );
  }
  return NextResponse.json(MOCK_ME_CUSTOMER);
}
