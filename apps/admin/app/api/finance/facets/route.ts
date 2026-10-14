import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockFinanceFacets } from "@/lib/mocks";

import { apiUrlFor } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

/**
 * BFF `GET /api/finance/facets` → Nest `GET /v1/finance/facets`
 * (categorias/produtos p/ filtros da projeção, exige `finance.read`).
 * TODO(backend pronto): este stub sai — proxy integral abaixo assume.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (API_INTERNAL_URL) {
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/facets`, {
      headers: { ...(session ? { Cookie: `aurum_session=${session}` } : {}) },
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  return NextResponse.json(mockFinanceFacets());
}
