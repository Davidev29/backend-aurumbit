import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiUrlFor, requireOrgId, upstreamAuthHeaders, upstreamRequiredOr502 } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const orgId = req.headers.get("x-org-id") ?? "";

  // financeiro é org-scoped: x-org-id obrigatório.
  const orgErr = requireOrgId(orgId);
  if (orgErr) return orgErr;

  // fail-closed: sem upstream de financeiro → 502, nunca mock.
  const missing = upstreamRequiredOr502("finance");
  if (missing) return missing;

  // Backend não possui endpoint de trace agregado; falha explícita (sem mock silencioso).
  return NextResponse.json(
    { code: "NOT_IMPLEMENTED", message: "Rastro financeiro não disponível no backend real ainda." },
    { status: 501 },
  );
}
