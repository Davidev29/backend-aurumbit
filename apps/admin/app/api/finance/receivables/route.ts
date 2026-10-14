import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockReceivablePage } from "@/lib/mocks";

import { apiUrlFor } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");
const STATUSES = ["PREVISTO", "PENDENTE", "RECEBIDO", "VENCIDO", "CANCELADO"];

/**
 * BFF `GET /api/finance/receivables?status=&category=&product=&from=&to=&cursor=` →
 * Nest `GET /v1/finance/receivables` (exige `finance.read`, cursor pagination).
 * TODO(backend pronto): este stub sai — proxy integral abaixo assume.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;

  if (API_INTERNAL_URL) {
    const upstream = await fetch(
      `${API_INTERNAL_URL}/v1/finance/receivables?${q.toString()}`,
      { headers: { ...(session ? { Cookie: `aurum_session=${session}` } : {}) } },
    );
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  const rawStatus = q.get("status");
  return NextResponse.json(
    mockReceivablePage(
      {
        status: STATUSES.includes(rawStatus ?? "") ? rawStatus : null,
        category: q.get("category"),
        product: q.get("product"),
        from: q.get("from"),
        to: q.get("to"),
      },
      q.get("cursor"),
      Number(q.get("limit")) || 20,
    ),
  );
}
