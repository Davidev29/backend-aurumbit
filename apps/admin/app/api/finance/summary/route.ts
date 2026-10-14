import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockFinanceSummary } from "@/lib/mocks";

import { apiUrlFor } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

/**
 * BFF `GET /api/finance/summary` → Nest `GET /v1/finance/summary`
 * (KPIs previsto/pendente/realizado + inadimplência, exige `finance.read`).
 * Retorna `isStale` quando o snapshot está desatualizado (UI exibe StaleBanner).
 * TODO(backend pronto): este stub sai — proxy integral abaixo assume.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (API_INTERNAL_URL) {
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/summary`, {
      headers: { ...(session ? { Cookie: `aurum_session=${session}` } : {}) },
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  return NextResponse.json(mockFinanceSummary());
}
