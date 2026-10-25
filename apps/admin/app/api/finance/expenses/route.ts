import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiUrlFor, requireOrgId, upstreamAuthHeaders, upstreamRequiredOr502 } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function POST(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();
  const orgId = req.headers.get("x-org-id") ?? "";

  // financeiro é org-scoped: x-org-id obrigatório.
  const orgErr = requireOrgId(orgId);
  if (orgErr) return orgErr;

  // fail-closed: sem upstream de financeiro → 502, nunca stub.
  const missing = upstreamRequiredOr502("finance");
  if (missing) return missing;

  try {
    const headers = upstreamAuthHeaders(session);
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = key;
    headers["x-org-id"] = orgId;
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/expenses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." }, { status: 502 });
  }
}
