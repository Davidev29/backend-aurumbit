import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiUrlFor, upstreamAuthHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const body = (await req.json().catch(() => ({}))) as { motivo?: string; confirmacao?: boolean };
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();
  const orgId = req.headers.get("x-org-id") ?? "";

  if (API_INTERNAL_URL) {
    try {
      if (typeof body.motivo !== "string" || body.motivo.trim().length < 10 || body.confirmacao !== true) {
        return NextResponse.json({ code: "BAD_REQUEST", message: "Motivo (mín. 10) e confirmação são obrigatórios." }, { status: 400 });
      }
      const headers = upstreamAuthHeaders(session);
      headers["Content-Type"] = "application/json";
      headers["Idempotency-Key"] = key;
      if (orgId) headers["x-org-id"] = orgId;

      const accRes = await fetch(`${API_INTERNAL_URL}/v1/finance/accounts`, { headers });
      const accounts = (await accRes.json().catch(() => [])) as Array<{ id: string; active?: boolean }>;
      const account = accounts.find((a) => a.active !== false) ?? accounts[0];
      if (!account?.id) {
        return NextResponse.json({ code: "ACCOUNT_REQUIRED", message: "Nenhuma conta financeira disponível." }, { status: 422 });
      }

      const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/receivables/${encodeURIComponent(params.id)}/mark-received`, {
        method: "POST",
        headers,
        body: JSON.stringify({ accountId: account.id, receivedAt: new Date().toISOString(), provider: "MANUAL" }),
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

  return NextResponse.json({ code: "UPSTREAM_MISSING", message: "Backend indisponível." }, { status: 502 });
}