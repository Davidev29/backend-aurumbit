import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clearAuthCookies, cookieContext, isStubSession, SESSION_COOKIE } from "@/lib/session";
import { getUpstreamBase } from "@/lib/upstream";

/**
 * BFF `POST /api/auth/logout` — encerra a sessão.
 *
 * Limpa SEMPRE os cookies locais (logout nunca falha para o usuário) e, quando
 * há upstream + sessão real, revoga a sessão/família no backend (best-effort:
 * o access tem 15min, mas o refresh viveria 30d sem isso).
 */
export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  const ctx = cookieContext(req);
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  const base = getUpstreamBase();

  if (base && session && !isStubSession(session)) {
    try {
      await fetch(`${base}/v1/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session}` },
        cache: "no-store",
      });
    } catch {
      // Best-effort: o refresh continua válido no servidor até expirar, mas o
      // usuário sai localmente do mesmo jeito.
    }
  }

  clearAuthCookies(res, ctx);
  return res;
}
