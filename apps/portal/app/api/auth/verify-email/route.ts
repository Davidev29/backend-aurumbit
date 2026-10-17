import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveUpstream } from "@/lib/upstream";

/**
 * BFF `POST /api/auth/verify-email` → Nest `POST /v1/auth/verify-email`.
 * Público: o token opaco (uso único, TTL 24h) chega pelo link
 * `/verificar-email?token=...` enviado após o cadastro.
 */
export async function POST(req: NextRequest) {
  const up = resolveUpstream();
  if (up.kind === "missing") return up.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Link inválido: token ausente." },
      { status: 422 }
    );
  }

  if (up.kind === "upstream") {
    try {
      const upstream = await fetch(`${up.base}/v1/auth/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await upstream.json().catch(() => ({}));
      // Backend responde `{ok:true}` sempre (anti-enumeração) e 4xx só em
      // payload inválido/limite de tentativas — repasse transparente.
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
        { status: 502 }
      );
    }
  }

  // Stub dev-only (sem upstream, nunca em prod): não existe token emitido
  // nesse modo — resposta honesta de stub, marcada como tal.
  return NextResponse.json({ ok: true, stub: true });
}
