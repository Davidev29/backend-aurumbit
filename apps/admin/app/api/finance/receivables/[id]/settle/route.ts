import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockReceivableById } from "@/lib/mocks";

import { apiUrlFor } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

/**
 * BFF `POST /api/finance/receivables/:id/settle` → Nest
 * `POST /v1/finance/receivables/:id/settle` (exige `finance.manage`, só admin).
 * Repassa `Idempotency-Key` (PROJECT §5); gera uma se ausente. A baixa cria
 * o `Transaction` realizado via `assertTransition` (REQUIREMENTS §3).
 * TODO(backend pronto): este stub sai — proxy integral abaixo assume.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const body = (await req.json().catch(() => ({}))) as { motivo?: string; confirmacao?: boolean };
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();

  if (API_INTERNAL_URL) {
    const upstream = await fetch(
      `${API_INTERNAL_URL}/v1/finance/receivables/${encodeURIComponent(params.id)}/settle`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          ...(session ? { Cookie: `aurum_session=${session}` } : {}),
        },
        body: JSON.stringify(body),
      },
    );
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  const receivable = mockReceivableById(params.id);
  if (!receivable) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Conta a receber não encontrada." }, { status: 404 });
  }
  if (receivable.status !== "PENDENTE" && receivable.status !== "VENCIDO") {
    return NextResponse.json(
      { code: "INVALID_TRANSITION", message: "Só contas pendentes ou vencidas podem ser baixadas." },
      { status: 422 },
    );
  }
  if (typeof body.motivo !== "string" || body.motivo.trim().length < 10 || body.confirmacao !== true) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Motivo (mín. 10) e confirmação são obrigatórios." },
      { status: 400 },
    );
  }
  const auditId = newKey();
  const res = NextResponse.json({
    transactionId: `txn-stub-${params.id}`,
    auditId,
    status: "RECEBIDO",
  });
  res.headers.set("X-Aurum-Audit", auditId);
  return res;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
