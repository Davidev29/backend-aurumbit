import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockFinanceSummary } from "@/lib/mocks";
import { apiUrlFor, upstreamAuthHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

/**
 * BFF `GET /api/finance/summary` → Nest `GET /v1/finance/overview`
 * (KPIs previsto/pendente/realizado + inadimplência, exige `finance.read`).
 * Mapeia cents → reais e buckets → FinanceSummary.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const orgId = req.headers.get("x-org-id") ?? "";

  if (API_INTERNAL_URL) {
    try {
      const headers = upstreamAuthHeaders(session);
      if (orgId) headers["x-org-id"] = orgId;
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/overview`, { headers });
      const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
      if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });

      const rec = (data.receivables ?? {}) as Record<string, number>;
      const pay = (data.payables ?? {}) as Record<string, number>;
      const previsto = ((rec.previstoCents ?? 0) + (pay.previstoCents ?? 0)) / 100;
      const pendente = ((rec.pendenteCents ?? 0) + (pay.pendenteCents ?? 0)) / 100;
      const realizado = ((rec.realizadoCents ?? 0) - (pay.realizadoCents ?? 0)) / 100;
      const inadimplente = (rec.inadimplenteCents ?? 0) / 100;
      const base = (rec.previstoCents ?? 0) + (rec.pendenteCents ?? 0) + (rec.realizadoCents ?? 0) + (rec.inadimplenteCents ?? 0);
      const taxa = base > 0 ? (rec.inadimplenteCents ?? 0) / base : 0;

      return NextResponse.json({
        previsto,
        pendente,
        realizado,
        inadimplente,
        taxaInadimplencia: taxa,
        currency: "BRL",
        isStale: false,
        asOf: new Date().toISOString(),
      });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." }, { status: 502 });
    }
  }

  return NextResponse.json(mockFinanceSummary());
}