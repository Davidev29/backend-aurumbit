import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockFinanceCsv } from "@/lib/mocks";
import type { FinanceExportScope } from "@/lib/types";
import { apiUrlFor, upstreamAuthHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");
const SCOPES: FinanceExportScope[] = ["payables", "receivables", "transactions"];

export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const orgId = req.headers.get("x-org-id") ?? "";
  const q = req.nextUrl.searchParams;
  const scope = q.get("scope");

  if (API_INTERNAL_URL) {
    try {
      const headers = upstreamAuthHeaders(session);
      if (orgId) headers["x-org-id"] = orgId;
      // Backend não possui endpoint de export CSV ainda.
      return NextResponse.json({ code: "NOT_IMPLEMENTED", message: "Exportação financeira não disponível no backend real ainda." }, { status: 501 });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." }, { status: 502 });
    }
  }

  if (!SCOPES.includes(scope as FinanceExportScope)) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "scope deve ser payables, receivables ou transactions." }, { status: 400 });
  }
  return new NextResponse(mockFinanceCsv(scope as FinanceExportScope), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="finance-${scope}.csv"`,
    },
  });
}