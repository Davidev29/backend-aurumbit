import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import type { CustomerSummaryCounts } from "@/lib/customers";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `GET /api/customers/summary` → Nest `GET /v1/admin/customers/summary`.
 *
 * Contagem por estágio do funil (cards do topo da tela Clientes). Sem
 * backend: tudo zerado (a UI mostra 0 e a lista segue o stub de demonstração)
 * — nunca inventa número.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const zero: CustomerSummaryCounts = {
    PROSPECT: 0,
    PENDING_PAYMENT: 0,
    ACTIVE: 0,
    SUSPENDED: 0,
    CANCELLED: 0,
  };

  if (!API_INTERNAL_URL) return NextResponse.json(zero);

  try {
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/admin/customers/summary`, {
      headers: upstreamAuthHeaders(session),
    });
    if (!upstream.ok) {
      return NextResponse.json(zero, { status: upstream.status });
    }
    const data = (await upstream.json().catch(() => ({}))) as Partial<CustomerSummaryCounts>;
    return NextResponse.json({ ...zero, ...data });
  } catch {
    return NextResponse.json(zero);
  }
}