import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/** BFF `POST /api/auth/logout` — invalida no Nest (best-effort) e limpa cookies. */
export async function POST(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (API_INTERNAL_URL) {
    try {
      await fetch(`${API_INTERNAL_URL}/v1/auth/logout`, {
        method: "POST",
        headers: upstreamAuthJsonHeaders(session),
        body: JSON.stringify({}),
      });
    } catch {
      // Logout local é idempotente — falha de rede não impede a saída.
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("aurum_session", "", { path: "/", maxAge: 0 });
  res.cookies.set("ab_refresh", "", { path: "/api/auth", maxAge: 0 });
  res.cookies.set("aurum_claims", "", { path: "/", maxAge: 0 });
  return res;
}
