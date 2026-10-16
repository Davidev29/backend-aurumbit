import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getUpstreamBase, isMockAllowed } from "@/lib/upstream";
import { supportCreate, supportList } from "@/lib/support-store";

/**
 * BFF `POST /api/support/conversations` — abre conversa (guest ou logado).
 * Proxy p/ Nest quando `API_INTERNAL_URL`; stub local em dev.
 * `GET` lista (usado pelo admin via mesmo contrato; portal usa só a própria).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    visitorName?: unknown;
    visitorEmail?: unknown;
    origin?: unknown;
    triage?: { topic?: unknown; label?: unknown } | null;
    customerId?: unknown;
    firstMessage?: unknown;
  };
  const base = getUpstreamBase();
  if (base) {
    try {
      const upstream = await fetch(`${base}/v1/support/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
  if (!isMockAllowed()) {
    return NextResponse.json(
      { code: "UPSTREAM_MISSING", message: "Backend indisponível (API_INTERNAL_URL não configurada)." },
      { status: 502 }
    );
  }
  const origin = body.origin === "portal" || body.origin === "admin" ? body.origin : "landpage";
  const triage =
    body.triage && typeof body.triage.topic === "string"
      ? { topic: String(body.triage.topic).slice(0, 60), label: String(body.triage.label ?? "").slice(0, 80) }
      : null;
  const { conversation, token } = supportCreate({
    visitorName: typeof body.visitorName === "string" ? body.visitorName : "Visitante",
    visitorEmail: typeof body.visitorEmail === "string" ? body.visitorEmail : undefined,
    origin,
    triage,
    customerId: typeof body.customerId === "string" ? body.customerId : undefined,
    firstMessage: typeof body.firstMessage === "string" ? body.firstMessage : undefined,
  });
  return NextResponse.json({ conversation, token }, { status: 201 });
}

export async function GET() {
  const base = getUpstreamBase();
  if (base) {
    try {
      const upstream = await fetch(`${base}/v1/support/conversations`, {
        headers: { "Content-Type": "application/json" },
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
  if (!isMockAllowed()) {
    return NextResponse.json({ code: "UPSTREAM_MISSING", message: "Backend indisponível." }, { status: 502 });
  }
  return NextResponse.json({ data: supportList(), presence: { onlineAgents: 1, onlineVisitors: supportList().length } });
}
