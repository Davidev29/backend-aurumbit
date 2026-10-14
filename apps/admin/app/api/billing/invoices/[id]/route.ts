import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import {
  resolveCustomerNames,
  toInvoiceView,
  toPaymentView,
  type NestInvoiceRow,
  type NestPaymentRow,
} from "@/lib/billing/map";
import { mockInvoiceById, mockPaymentsByInvoice } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `GET /api/billing/invoices/:id` → Nest `GET /v1/billing/invoices/:id` +
 * `GET /v1/billing/invoices/:id/payments` (aba Pagamentos; vazio honesto).
 * Responde `{invoice, payments}` (contrato da UI). Stub sem `API_INTERNAL_URL`.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (API_INTERNAL_URL) {
    try {
      const headers = upstreamAuthHeaders(session);
      const [invRes, payRes] = await Promise.all([
        fetch(`${API_INTERNAL_URL}/v1/billing/invoices/${encodeURIComponent(params.id)}`, { headers }),
        fetch(`${API_INTERNAL_URL}/v1/billing/invoices/${encodeURIComponent(params.id)}/payments`, {
          headers,
        }),
      ]);
      const invData = (await invRes.json().catch(() => ({}))) as NestInvoiceRow;
      if (!invRes.ok) {
        return NextResponse.json(invData, { status: invRes.status });
      }
      const payData = (await payRes.json().catch(() => [])) as NestPaymentRow[];
      const names = await resolveCustomerNames(API_INTERNAL_URL, headers, [invData.customerId]);
      const invoice = toInvoiceView(invData, names.get(invData.customerId) ?? invData.customerId);
      return NextResponse.json({
        invoice,
        payments: (Array.isArray(payData) ? payData : []).map((p) =>
          toPaymentView(p, invoice.correlationId),
        ),
      });
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
  return NextResponse.json({ invoice, payments: mockPaymentsByInvoice(params.id) });
}
