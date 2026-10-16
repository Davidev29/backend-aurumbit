import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_SUPPORT_CONVERSATIONS } from "@/lib/support-mocks";
import { devArchiveSet } from "@/lib/support-dev-store";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const session = req.cookies.get("aurum_session")?.value ?? "";
  if (API_INTERNAL_URL) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/support/conversations/${encodeURIComponent(params.id)}`, {
        method: "PATCH",
        headers: upstreamAuthJsonHeaders(session),
        body: JSON.stringify(body),
      });
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." }, { status: 502 });
    }
  }
  // Dev sem upstream: persiste o arquivamento em memória (store compartilhado
  // com o `GET ?archived=true`), para a gaveta funcionar sem backend.
  if (body.archived !== undefined) {
    const archivedAt = devArchiveSet(params.id, body.archived === true);
    const base = MOCK_SUPPORT_CONVERSATIONS.find((c) => c.id === params.id) ?? { id: params.id };
    return NextResponse.json({ conversation: { ...base, archivedAt } });
  }
  return NextResponse.json({ conversation: { id: params.id, ...body } });
}
