import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockFinanceCsv } from "@/lib/mocks";
import type { FinanceExportScope } from "@/lib/types";

import { apiUrlFor } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");
const SCOPES: FinanceExportScope[] = ["payables", "receivables", "transactions"];

/**
 * BFF `GET /api/finance/export?scope=` → Nest `GET /v1/finance/export`
 * (exige `finance.manage`, mesma regra de pagar/baixar — PROJECT §3).
 * Stub CSV (`;`-separado, pt-BR) com TODO backend: gerar no Nest com 403
 * sem `finance.read` + auditoria do export.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;
  const scope = q.get("scope");

  if (API_INTERNAL_URL) {
    const upstream = await fetch(
      `${API_INTERNAL_URL}/v1/finance/export?${q.toString()}`,
      { headers: { ...(session ? { Cookie: `aurum_session=${session}` } : {}) } },
    );
    const text = await upstream.text().catch(() => "");
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="finance-${scope ?? "export"}.csv"`,
      },
    });
  }

  if (!SCOPES.includes(scope as FinanceExportScope)) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "scope deve ser payables, receivables ou transactions." },
      { status: 400 },
    );
  }
  // TODO(backend pronto): gerar no Nest (filtros aplicados + audit `finance.export`).
  return new NextResponse(mockFinanceCsv(scope as FinanceExportScope), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="finance-${scope}.csv"`,
    },
  });
}
