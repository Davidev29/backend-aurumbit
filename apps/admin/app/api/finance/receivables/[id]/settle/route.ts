import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiUrlFor, requireOrgId, upstreamAuthHeaders, upstreamRequiredOr502 } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const body = (await req.json().catch(() => ({}))) as {
    motivo?: string;
    confirmacao?: boolean;
    accountId?: string;
  };
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();
  const orgId = req.headers.get("x-org-id") ?? "";

  // financeiro é org-scoped: x-org-id obrigatório.
  const orgErr = requireOrgId(orgId);
  if (orgErr) return orgErr;

  // fail-closed: sem upstream de financeiro → 502, nunca stub.
  const missing = upstreamRequiredOr502("finance");
  if (missing) return missing;

  try {
    if (typeof body.motivo !== "string" || body.motivo.trim().length < 10 || body.confirmacao !== true) {
      return NextResponse.json({ code: "BAD_REQUEST", message: "Motivo (mín. 10) e confirmação são obrigatórios." }, { status: 400 });
    }
    // accountId vem da UI e é repassado ao upstream (não resolve conta automaticamente).
    if (typeof body.accountId !== "string" || !body.accountId.trim()) {
      return NextResponse.json({ code: "BAD_REQUEST", message: "accountId é obrigatório." }, { status: 400 });
    }

    const headers = upstreamAuthHeaders(session);
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = key;
    headers["x-org-id"] = orgId;

    const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/receivables/${encodeURIComponent(params.id)}/mark-received`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId: body.accountId, receivedAt: new Date().toISOString(), provider: "MANUAL" }),
    });
    const data = (await upstream.json().catch(() => ({}))) as { receivable?: { id: string; status: string }; transaction?: { id: string } };
    if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });

    return NextResponse.json({
      transactionId: data.transaction?.id ?? `txn-${params.id}`,
      auditId: key,
      status: data.receivable?.status ?? "RECEBIDO",
    });
  } catch {
    return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." }, { status: 502 });
  }
}
