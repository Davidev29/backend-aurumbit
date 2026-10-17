import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveUpstream } from "@/lib/upstream";

/**
 * BFF `POST /api/auth/resend-verification` → Nest `POST /v1/auth/resend-verification`.
 * Público e genérico no backend (não revela se o e-mail existe): usado pelo
 * aviso pós-cadastro e pelo 403 `EMAIL_NOT_VERIFIED` do login.
 */
export async function POST(req: NextRequest) {
  const up = resolveUpstream();
  if (up.kind === "missing") return up.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ code: "UNPROCESSABLE", message: "E-mail inválido." }, { status: 422 });
  }

  if (up.kind === "upstream") {
    try {
      const upstream = await fetch(`${up.base}/v1/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
        { status: 502 }
      );
    }
  }

  // Stub dev-only (sem upstream, nunca em prod): sem outbox, nada a reenviar.
  return NextResponse.json({ ok: true, stub: true });
}
