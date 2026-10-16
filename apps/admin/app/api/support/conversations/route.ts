import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_SUPPORT_CONVERSATIONS } from "@/lib/support-mocks";
import { upstreamAuthHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `GET /api/support/conversations` → Nest `GET /v1/support/conversations` (JWT).
 * Repassa a sessão staff (`aurum_session` → `Authorization: Bearer`) — sem ela
 * o Nest responde 401 e a fila do admin fica vazia (vínculo landpage↔admin quebrado).
 * Sem upstream (dev): mocks locais. Sem sessão e sem backend: lista mock p/
 * desenvolvimento (mesmo padrão `lib/mocks.ts` do admin).
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  if (API_INTERNAL_URL) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/support/conversations`, {
        headers: upstreamAuthHeaders(session),
      });
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 }
      );
    }
  }
  return NextResponse.json({ data: MOCK_SUPPORT_CONVERSATIONS, presence: { onlineAgents: 1, onlineVisitors: 2 } });
}
