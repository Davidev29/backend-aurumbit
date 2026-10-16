import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_SUPPORT_MESSAGES } from "@/lib/support-mocks";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import type { ChatMessage } from "@/lib/support-types";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

// Store mutável em memória (dev sem upstream) — ecoa o envio do admin.
const localExtra = new Map<string, ChatMessage[]>();

function localMessages(id: string): ChatMessage[] {
  return [...(MOCK_SUPPORT_MESSAGES[id] ?? []), ...(localExtra.get(id) ?? [])];
}

/** BFF `GET .../messages` (admin: sessão staff repassada como Bearer; sem ela o Nest devolve FORBIDDEN). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  if (API_INTERNAL_URL) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/support/conversations/${encodeURIComponent(params.id)}/messages`, {
        headers: upstreamAuthJsonHeaders(session),
      });
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." }, { status: 502 });
    }
  }
  return NextResponse.json({ data: localMessages(params.id) });
}

/** BFF `POST .../messages` — agente envia; sem upstream, ecoa em memória. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { sender?: string; authorName?: string; body?: string };
  const session = req.cookies.get("aurum_session")?.value ?? "";
  if (API_INTERNAL_URL) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/support/conversations/${encodeURIComponent(params.id)}/messages`, {
        method: "POST",
        headers: upstreamAuthJsonHeaders(session),
        body: JSON.stringify({ sender: "agent", authorName: body.authorName ?? "Atendimento", body: body.body ?? "" }),
      });
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." }, { status: 502 });
    }
  }
  const text = (body.body || "").trim().slice(0, 2000);
  if (!text) return NextResponse.json({ code: "UNPROCESSABLE", message: "Mensagem vazia." }, { status: 422 });
  const msg: ChatMessage = {
    id: `msg-local-${Date.now().toString(36)}`,
    conversationId: params.id,
    sender: "agent",
    authorName: (body.authorName || "Atendimento").slice(0, 80),
    body: text,
    status: "delivered",
    createdAt: new Date().toISOString(),
  };
  const arr = localExtra.get(params.id) ?? [];
  arr.push(msg);
  localExtra.set(params.id, arr);
  return NextResponse.json({ message: msg }, { status: 201 });
}
