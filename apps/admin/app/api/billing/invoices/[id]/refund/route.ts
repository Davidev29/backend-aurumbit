import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import type { NestPaymentRow } from "@/lib/billing/map";
import { mockInvoiceById } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/billing/invoices/:id/refund` → Nest
 * `POST /v1/billing/payments/:paymentId/refund` (o refund é por pagamento,
 * não por fatura). Resolve o CONFIRMED mais recente; sem ele → 422 (mesma
 * regra do stub: "só faturas pagas"). Exige `billing.manage` + motivo ≥ 10 +
 * confirmação. `Idempotency-Key` repassado (PROJECT §5).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const body = (await req.json().catch(() => ({}))) as { motivo?: string; confirmacao?: boolean };
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();

  if (API_INTERNAL_URL) {
    if (typeof body.motivo !== "string" || body.motivo.trim().length < 10 || body.confirmacao !== true) {
      return NextResponse.json(
        { code: "BAD_REQUEST", message: "Motivo (mín. 10) e confirmação são obrigatórios." },
        { status: 400 },
      );
    }
    try {
      const headers = { ...upstreamAuthJsonHeaders(session), "Idempotency-Key": key };
      const payRes = await fetch(
        `${API_INTERNAL_URL}/v1/billing/invoices/${encodeURIComponent(params.id)}/payments`,
        { headers },
      );
      const payments = (await payRes.json().catch(() => [])) as NestPaymentRow[];
      if (!payRes.ok) {
        return NextResponse.json(payments, { status: payRes.status });
      }
      const confirmed = (Array.isArray(payments) ? payments : [])
        .filter((p) => p.status === "CONFIRMED")
        .sort((a, b) => ((b.paidAt ?? b.createdAt) < (a.paidAt ?? a.createdAt) ? -1 : 1))[0];
      if (!confirmed) {
        return NextResponse.json(
          { code: "INVALID_TRANSITION", message: "Só faturas pagas podem ser estornadas." },
          { status: 422 },
        );
      }
      const refundRes = await fetch(
        `${API_INTERNAL_URL}/v1/billing/payments/${encodeURIComponent(confirmed.id)}/refund`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ amount_cents: confirmed.amountCents, reason: body.motivo.trim() }),
        },
      );
      const refundData = (await refundRes.json().catch(() => ({}))) as { id?: string };
      if (!refundRes.ok) {
        return NextResponse.json(refundData, { status: refundRes.status });
      }
      const auditId = newKey();
      const res = NextResponse.json({ refundId: refundData.id, auditId, status: "REFUNDED" });
      res.headers.set("X-Aurum-Audit", auditId);
      return res;
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
  }

  const invoice = mockInvoiceById(params.id);
  if (!invoice) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Fatura não encontrada." }, { status: 404 });
  }
  if (invoice.status !== "PAID") {
    return NextResponse.json(
      { code: "INVALID_TRANSITION", message: "Só faturas pagas podem ser estornadas." },
      { status: 422 },
    );
  }
  if (typeof body.motivo !== "string" || body.motivo.trim().length < 10 || body.confirmacao !== true) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Motivo (mín. 10) e confirmação são obrigatórios." },
      { status: 400 },
    );
  }
  const auditId = newKey();
  const res = NextResponse.json({ refundId: `ref-stub-${params.id}`, auditId, status: "REFUNDED" });
  res.headers.set("X-Aurum-Audit", auditId);
  return res;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
