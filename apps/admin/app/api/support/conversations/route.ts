import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_SUPPORT_CONVERSATIONS } from "@/lib/support-mocks";
import { devArchivedAt } from "@/lib/support-dev-store";
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
  // `?archived=true` alimenta a gaveta de arquivados (lixeira auditável).
  const archived = req.nextUrl.searchParams.get("archived") === "true" ? "?archived=true" : "";
  if (API_INTERNAL_URL) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/support/conversations${archived}`, {
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
  // Dev sem upstream: aplica o arquivamento em memória sobre os mocks.
  // `?archived=true` alimenta a gaveta; sem flag, arquivadas saem da fila.
  const onlyArchived = req.nextUrl.searchParams.get("archived") === "true";
  const data = MOCK_SUPPORT_CONVERSATIONS.map((c) => ({ ...c, archivedAt: devArchivedAt(c.id) })).filter((c) =>
    onlyArchived ? c.archivedAt != null : c.archivedAt == null
  );
  return NextResponse.json({ data, presence: { onlineAgents: 1, onlineVisitors: 2 } });
}
