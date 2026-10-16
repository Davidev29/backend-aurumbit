import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUpstreamBase, isMockAllowed } from "@/lib/upstream";
import { supportCheck, supportGet, supportPatch } from "@/lib/support-store";

function tokenOf(req: NextRequest): string | null {
  return req.headers.get("x-chat-token") ?? req.nextUrl.searchParams.get("token");
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const base = getUpstreamBase();
  const t = tokenOf(req) ?? "";
  if (base) {
    try {
      const upstream = await fetch(`${base}/v1/support/conversations/${encodeURIComponent(params.id)}`, {
        headers: { "Content-Type": "application/json", ...(t ? { "x-chat-token": t } : {}) },
      });
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." }, { status: 502 });
    }
  }
  if (!isMockAllowed()) return NextResponse.json({ code: "UPSTREAM_MISSING", message: "Backend indisponível." }, { status: 502 });
  const s = supportGet(params.id);
  if (!s || !supportCheck(params.id, t, false)) {
    return NextResponse.json({ code: "FORBIDDEN", message: "Conversa não encontrada." }, { status: 403 });
  }
  return NextResponse.json({ conversation: s.conversation });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { status?: "open" | "pending" | "active" | "closed"; assignee?: string | null };
  const base = getUpstreamBase();
  if (base) {
    try {
      const upstream = await fetch(`${base}/v1/support/conversations/${encodeURIComponent(params.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." }, { status: 502 });
    }
  }
  if (!isMockAllowed()) return NextResponse.json({ code: "UPSTREAM_MISSING", message: "Backend indisponível." }, { status: 502 });
  const updated = supportPatch(params.id, { status: body.status, assignee: body.assignee });
  if (!updated) return NextResponse.json({ code: "NOT_FOUND", message: "Não encontrada." }, { status: 404 });
  return NextResponse.json({ conversation: updated });
}
