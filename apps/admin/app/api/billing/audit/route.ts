import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import type { AuditEventView, Page } from "@/lib/types";
import { mockAuditPage } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

interface NestAuditRow {
  id: string;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

function toView(e: NestAuditRow): AuditEventView {
  const meta = (e.metadata ?? {}) as Record<string, unknown>;
  const correlationId =
    typeof meta.correlationId === "string" && meta.correlationId
      ? meta.correlationId
      : (e.entityId ?? e.id);
  return {
    id: e.id,
    actor: e.actorId ?? "system",
    action: e.action,
    resource: e.entity,
    resourceId: e.entityId ?? "",
    correlationId,
    occurredAt: e.createdAt,
    metadataMasked: meta,
  };
}

/**
 * BFF `GET /api/billing/audit?actor=&resource=&correlationId=&from=&to=&cursor=`
 * → Nest `GET /v1/audit/events` (PG append-only, filtros + cursor no servidor).
 * A trilha PG ainda está sendo povoada pelos workstreams (hoje pode estar
 * vazia — EmptyState honesto, nunca stub silencioso).
 * Sem `API_INTERNAL_URL`: stub (`mockAuditPage`).
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;

  if (API_INTERNAL_URL) {
    try {
      const params = new URLSearchParams();
      for (const [from, to] of [
        ["actor", "actor"],
        ["resource", "resource"],
        ["correlationId", "correlation_id"],
        ["from", "from"],
        ["to", "to"],
        ["cursor", "cursor"],
        ["limit", "limit"],
      ] as const) {
        const v = q.get(from);
        if (v) params.set(to, v);
      }
      if (!params.get("limit")) params.set("limit", "20");
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/audit/events?${params.toString()}`, {
        headers: upstreamAuthHeaders(session),
      });
      const data = (await upstream.json().catch(() => ({}))) as {
        data?: NestAuditRow[];
        meta?: { nextCursor: string | null; limit: number };
      };
      if (!upstream.ok) {
        return NextResponse.json(data, { status: upstream.status });
      }
      const page: Page<AuditEventView> = {
        data: (Array.isArray(data.data) ? data.data : []).map(toView),
        meta: data.meta ?? { nextCursor: null, limit: 20 },
      };
      return NextResponse.json(page);
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    mockAuditPage(
      {
        actor: q.get("actor"),
        resource: q.get("resource"),
        correlationId: q.get("correlationId"),
        from: q.get("from"),
        to: q.get("to"),
      },
      q.get("cursor"),
      Number(q.get("limit")) || 20,
    ),
  );
}
