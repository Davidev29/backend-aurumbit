import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_MY_INVOICES } from "@/lib/mocks";
import { resolveUpstream } from "@/lib/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const SESSION_COOKIE = "aurum_portal_session";

/** GET /api/me/invoices — faturas do titular. */
export async function GET(req: NextRequest) {
  const __up = resolveUpstream();
  if (__up.kind === "missing") return __up.response;
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Não autenticado." }, { status: 401 });
  }
  if (API_INTERNAL_URL && !session.startsWith("stub-")) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/billing/invoices/mine`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      const data = (await upstream.json().catch(() => ({}))) as unknown;
      if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });

      // Mapeia a fatura do billing (snake/camel misto do PG) para o shape do portal.
      const rows = Array.isArray(data) ? data : [];
      const mapped = rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        amount: r.amountCents ?? r.amount_cents ?? 0,
        currency: "BRL",
        status: r.status,
        dueDate: r.dueDate ?? r.due_date,
        paidAt: r.paidAt ?? r.paid_at ?? null,
        externalId: r.orderId ?? r.order_id ?? r.id,
        provider: "ASAAS",
        correlationId: r.id,
        productName: r.productId ?? r.product_id ?? undefined,
        planName: r.planRef ?? r.plan_ref ?? undefined,
        downloadUrl: undefined,
      }));
      return NextResponse.json(mapped);
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
        { status: 502 }
      );
    }
  }
  return NextResponse.json(MOCK_MY_INVOICES);
}