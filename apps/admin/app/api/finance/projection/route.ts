import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockProjection } from "@/lib/mocks";
import type { Period } from "@/lib/types";
import { apiUrlFor, upstreamAuthHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");
const PERIODS: Period[] = ["week", "month", "year"];

export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;
  const orgId = req.headers.get("x-org-id") ?? "";

  if (API_INTERNAL_URL) {
    try {
      const period = (q.get("period") as Period) || "month";
      const scope = period === "year" ? "annual" : "monthly";
      const ref = new Date().toISOString().slice(0, 10);
      const params = new URLSearchParams({ scope, ref, tz: "America/Sao_Paulo" });
      const headers = upstreamAuthHeaders(session);
      if (orgId) headers["x-org-id"] = orgId;
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/projections?${params.toString()}`, { headers });
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." }, { status: 502 });
    }
  }

  const rawPeriod = q.get("period");
  const period: Period = PERIODS.includes(rawPeriod as Period) ? (rawPeriod as Period) : "month";
  const { points, isStale, staleReason, asOf } = mockProjection(period, q.get("category"), q.get("product"));
  return NextResponse.json({ points, period, isStale, staleReason, asOf });
}