import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveUpstream } from "@/lib/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const SESSION_COOKIE = "aurum_portal_session";

/**
 * POST /api/me/licenses/:id/reveal — revela chave 1x (auditado).
 * Exige motivo ≥ 10 + confirmação explícita. Rate-limit é do backend (10/h).
 * Stub: retorna chave sintética + auditId (nunca persiste plaintext).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const __up = resolveUpstream();
  if (__up.kind === "missing") return __up.response;
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Não autenticado." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown; confirm?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 10) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Motivo deve ter ao menos 10 caracteres." },
      { status: 422 }
    );
  }
  if (body.confirm !== true) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Confirmação explícita obrigatória." },
      { status: 422 }
    );
  }

  if (API_INTERNAL_URL && !session.startsWith("stub-")) {
    try {
      const upstream = await fetch(
        `${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(params.id)}/reveal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
          body: JSON.stringify({ reason }),
        }
      );
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
        { status: 502 }
      );
    }
  }

  const tail = Date.now().toString(36).toUpperCase().slice(-4).padStart(4, "0");
  // Stub dev-only (sem upstream, fora de prod): chave sintética, marcada stub:true.
  return NextResponse.json({
    stub: true,
    key: `AURUM-DEMO-DEMO-${tail}`,
    auditId: `aud-reveal-${Date.now().toString(36)}`,
  });
}
