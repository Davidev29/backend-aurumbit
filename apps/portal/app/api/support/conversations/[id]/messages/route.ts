import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUpstreamBase, isMockAllowed } from "@/lib/upstream";
import { supportCheck, supportGet, supportPost } from "@/lib/support-store";

function tokenOf(req: NextRequest): string | null {
  return req.headers.get("x-chat-token") ?? req.nextUrl.searchParams.get("token");
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const t = tokenOf(req) ?? "";
  const base = getUpstreamBase();
  if (base) {
    try {
      const upstream = await fetch(`${base}/v1/support/conversations/${encodeURIComponent(params.id)}/messages`, {
        headers: { "Content-Type": "application/json", ...(t ? { "x-chat-token": t } : {}) },
      });
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." }, { status: 502 });
    }
  }
  if (!isMockAllowed()) return NextResponse.json({ code: "UPSTREAM_MISSING", message: "Backend indisponível." }, { status: 502 });
  if (!supportCheck(params.id, t, true)) {
    // Em dev o admin lê sem token; o visitante precisa do token.
    const s = supportGet(params.id);
    if (!s) return NextResponse.json({ code: "NOT_FOUND", message: "Não encontrada." }, { status: 404 });
  }
  const s = supportGet(params.id);
  if (!s) return NextResponse.json({ code: "NOT_FOUND", message: "Não encontrada." }, { status: 404 });
  return NextResponse.json({ data: s.messages });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { sender?: string; authorName?: string; body?: string };
  const t = tokenOf(req) ?? "";
  const base = getUpstreamBase();
  if (base) {
    try {
      const upstream = await fetch(`${base}/v1/support/conversations/${encodeURIComponent(params.id)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(t ? { "x-chat-token": t } : {}) },
        body: JSON.stringify(body),
      });
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." }, { status: 502 });
    }
  }
  if (!isMockAllowed()) return NextResponse.json({ code: "UPSTREAM_MISSING", message: "Backend indisponível." }, { status: 502 });
  const msg = supportPost(params.id, {
    sender: body.sender === "agent" ? "agent" : body.sender === "system" ? "system" : "visitor",
    authorName: typeof body.authorName === "string" ? body.authorName : undefined,
    body: typeof body.body === "string" ? body.body : "",
  });
  if (!msg) return NextResponse.json({ code: "UNPROCESSABLE", message: "Mensagem vazia." }, { status: 422 });
  // Auto-resposta suave do atendente em dev (demonstra o duplo check + digitação).
  if (msg.sender === "visitor") {
    const id = params.id;
    setTimeout(() => {
      try {
        supportPost(id, {
          sender: "agent",
          authorName: "Ana · Atendimento",
          body: "Recebi! Um especialista já está com sua conversa aberta. Pode me contar um pouco mais?",
        });
      } catch {
        /* noop */
      }
    }, 1800);
  }
  return NextResponse.json({ message: msg }, { status: 201 });
}
