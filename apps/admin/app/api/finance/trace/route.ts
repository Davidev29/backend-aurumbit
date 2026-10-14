import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  mockAuditByCorrelation,
  mockInvoiceById,
  mockPayableById,
  mockPaymentsByInvoice,
  mockReceivableById,
  mockTransactionsBySource,
} from "@/lib/mocks";

import { apiUrlFor } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

/**
 * BFF `GET /api/finance/trace?receivableId=&payableId=` → Nest
 * `GET /v1/finance/trace` (exige `finance.read`). Compõe a cadeia
 * charge → invoice → receivable/payable → transaction → audit via
 * `correlationId` propagado (REQUIREMENTS §4, PROJECT §5).
 * TODO(backend pronto): este stub sai — proxy integral abaixo assume.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;

  if (API_INTERNAL_URL) {
    const upstream = await fetch(
      `${API_INTERNAL_URL}/v1/finance/trace?${q.toString()}`,
      { headers: { ...(session ? { Cookie: `aurum_session=${session}` } : {}) } },
    );
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  const receivableId = q.get("receivableId");
  const payableId = q.get("payableId");

  if (receivableId) {
    const receivable = mockReceivableById(receivableId);
    if (!receivable) {
      return NextResponse.json({ code: "NOT_FOUND", message: "Conta a receber não encontrada." }, { status: 404 });
    }
    const invoice = receivable.invoiceId ? mockInvoiceById(receivable.invoiceId) : null;
    return NextResponse.json({
      invoice,
      payments: invoice ? mockPaymentsByInvoice(invoice.id) : [],
      receivable,
      payable: null,
      transactions: mockTransactionsBySource(receivable.id),
      audit: mockAuditByCorrelation(receivable.correlationId),
    });
  }

  if (payableId) {
    const payable = mockPayableById(payableId);
    if (!payable) {
      return NextResponse.json({ code: "NOT_FOUND", message: "Conta a pagar não encontrada." }, { status: 404 });
    }
    return NextResponse.json({
      invoice: null,
      payments: [],
      receivable: null,
      payable,
      transactions: mockTransactionsBySource(payable.id),
      audit: mockAuditByCorrelation(payable.correlationId),
    });
  }

  return NextResponse.json(
    { code: "BAD_REQUEST", message: "Informe receivableId ou payableId." },
    { status: 400 },
  );
}
