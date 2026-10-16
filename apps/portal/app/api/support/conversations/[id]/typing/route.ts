import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUpstreamBase, isMockAllowed } from "@/lib/upstream";

/** `POST typing` é transiente: com upstream, repassa; sem upstream, 200 imediato (o SSE local cobre). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const t = req.headers.get("x-chat-token") ?? req.nextUrl.searchParams.get("token") ?? "";
  const base = getUpstreamBase();
  if (base) {
    try {
      const upstream = await fetch(`${base}/v1/support/conversations/${encodeURIComponent(params.id)}/typing`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(t ? { "x-chat-token": t } : {}) },
        body: JSON.stringify(body),
      });
      const data = await upstream.json().catch(() => ({ ok: true }));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json({ ok: true, degraded: true });
    }
  }
  if (!isMockAllowed()) return NextResponse.json({ code: "UPSTREAM_MISSING", message: "Backend indisponível." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
