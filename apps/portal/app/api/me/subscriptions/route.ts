import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_MY_SUBSCRIPTIONS } from "@/lib/mocks";
import { resolveUpstream } from "@/lib/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const SESSION_COOKIE = "aurum_portal_session";

/** GET /api/me/subscriptions — assinaturas do titular. */
export async function GET(req: NextRequest) {
  const __up = resolveUpstream();
  if (__up.kind === "missing") return __up.response;
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Não autenticado." }, { status: 401 });
  }
  if (API_INTERNAL_URL && !session.startsWith("stub-")) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/billing/subscriptions/mine`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      const data = (await upstream.json().catch(() => ({}))) as unknown;
      if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });

      const rows = Array.isArray(data) ? data : [];
      const mapped = rows.map((r: Record<string, unknown>) => {
        const status = String(r.status ?? "DRAFT");
        const mappedStatus =
          status === "ACTIVE"
            ? "ACTIVE"
            : status === "CANCELLED"
              ? "CANCELLED"
              : "TRIAL";
        return {
          id: r.id,
          planName: r.planRef ?? r.plan_ref ?? "Plano",
          status: mappedStatus,
          amount: 0,
          currency: "BRL",
          nextDue: r.currentPeriodEnd ?? r.current_period_end ?? r.createdAt ?? r.created_at,
          externalId: r.id,
          productName: r.planRef ?? r.plan_ref ?? undefined,
        };
      });
      return NextResponse.json(mapped);
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
        { status: 502 }
      );
    }
  }
  return NextResponse.json(MOCK_MY_SUBSCRIPTIONS);
}