import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockFinanceFacets } from "@/lib/mocks";
import { apiUrlFor, upstreamAuthHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const orgId = req.headers.get("x-org-id") ?? "";

  if (API_INTERNAL_URL) {
    try {
      const headers = upstreamAuthHeaders(session);
      if (orgId) headers["x-org-id"] = orgId;
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/categories`, { headers });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });
      const rows = Array.isArray(data) ? data : [];
      const categories = Array.from(new Set(rows.map((r: Record<string, unknown>) => String(r.name ?? r.code ?? "")).filter(Boolean))).sort();
      return NextResponse.json({ categories, products: [] });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." }, { status: 502 });
    }
  }

  return NextResponse.json(mockFinanceFacets());
}