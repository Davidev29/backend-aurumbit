import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiUrlFor, upstreamAuthHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const orgId = req.headers.get("x-org-id") ?? "";

  if (API_INTERNAL_URL) {
    try {
      const headers = upstreamAuthHeaders(session);
      if (orgId) headers["x-org-id"] = orgId;
      // Backend não possui endpoint de trace agregado; falha explícita (sem mock silencioso).
      return NextResponse.json({ code: "NOT_IMPLEMENTED", message: "Rastro financeiro não disponível no backend real ainda." }, { status: 501 });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." }, { status: 502 });
    }
  }

  // fallback mock apenas em modo frontend-first (sem API)
  const { mockAuditByCorrelation, mockInvoiceById, mockPayableById, mockPaymentsByInvoice, mockReceivableById, mockTransactionsBySource } = await import("@/lib/mocks");
  const q = req.nextUrl.searchParams;
  const receivableId = q.get("receivableId");
  const payableId = q.get("payableId");
  if (receivableId) {
    const receivable = mockReceivableById(receivableId);
    if (!receivable) return NextResponse.json({ code: "NOT_FOUND", message: "Conta a receber não encontrada." }, { status: 404 });
    const invoice = receivable.invoiceId ? mockInvoiceById(receivable.invoiceId) : null;
    return NextResponse.json({ invoice, payments: invoice ? mockPaymentsByInvoice(invoice.id) : [], receivable, payable: null, transactions: mockTransactionsBySource(receivable.id), audit: mockAuditByCorrelation(receivable.correlationId) });
  }
  if (payableId) {
    const payable = mockPayableById(payableId);
    if (!payable) return NextResponse.json({ code: "NOT_FOUND", message: "Conta a pagar não encontrada." }, { status: 404 });
    return NextResponse.json({ invoice: null, payments: [], receivable: null, payable, transactions: mockTransactionsBySource(payable.id), audit: mockAuditByCorrelation(payable.correlationId) });
  }
  return NextResponse.json({ code: "BAD_REQUEST", message: "Informe receivableId ou payableId." }, { status: 400 });
}