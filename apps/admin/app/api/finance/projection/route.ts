import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockProjection } from "@/lib/mocks";
import type { Period } from "@/lib/types";

import { apiUrlFor } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");
const PERIODS: Period[] = ["week", "month", "year"];

/**
 * BFF `GET /api/finance/projection?period=&category=&product=` → Nest
 * `GET /v1/finance/projection` (receita×despesa, exige `finance.read`).
 * TODO(backend pronto): este stub sai — proxy integral abaixo assume
 * (snapshot com hash `ProjectionSnapshot` no backend).
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;

  if (API_INTERNAL_URL) {
    const upstream = await fetch(
      `${API_INTERNAL_URL}/v1/finance/projection?${q.toString()}`,
      { headers: { ...(session ? { Cookie: `aurum_session=${session}` } : {}) } },
    );
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  const rawPeriod = q.get("period");
  const period: Period = PERIODS.includes(rawPeriod as Period) ? (rawPeriod as Period) : "month";
  const { points, isStale, staleReason, asOf } = mockProjection(period, q.get("category"), q.get("product"));
  return NextResponse.json({ points, period, isStale, staleReason, asOf });
}
