import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { FinanceExportScope } from "@/lib/types";
import { apiUrlFor, requireOrgId, upstreamRequiredOr502 } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");
const SCOPES: FinanceExportScope[] = ["payables", "receivables", "transactions"];

export async function GET(req: NextRequest) {
  const orgId = req.headers.get("x-org-id") ?? "";
  const q = req.nextUrl.searchParams;
  const scope = q.get("scope");

  // financeiro é org-scoped: x-org-id obrigatório.
  const orgErr = requireOrgId(orgId);
  if (orgErr) return orgErr;

  if (!SCOPES.includes(scope as FinanceExportScope)) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "scope deve ser payables, receivables ou transactions." }, { status: 400 });
  }

  // fail-closed: sem upstream de financeiro → 502, nunca mock.
  const missing = upstreamRequiredOr502("finance");
  if (missing) return missing;

  // Backend não possui endpoint de export CSV ainda; falha explícita (sem mock silencioso).
  return NextResponse.json({ code: "NOT_IMPLEMENTED", message: "Exportação financeira não disponível no backend real ainda." }, { status: 501 });
}
