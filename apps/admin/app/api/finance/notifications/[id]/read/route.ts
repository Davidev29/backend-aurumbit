import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiUrlFor, requireOrgId, upstreamAuthHeaders, upstreamRequiredOr502 } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const orgId = req.headers.get("x-org-id") ?? "";

  // financeiro é org-scoped: x-org-id obrigatório.
  const orgErr = requireOrgId(orgId);
  if (orgErr) return orgErr;

  // fail-closed: sem upstream de financeiro → 502, nunca mock.
  const missing = upstreamRequiredOr502("finance");
  if (missing) return missing;

  try {
    const headers = upstreamAuthHeaders(session);
    headers["Content-Type"] = "application/json";
    headers["x-org-id"] = orgId;
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/notifications/${encodeURIComponent(params.id)}/read`, {
      method: "POST",
      headers,
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." }, { status: 502 });
  }
}
