import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockSubscriptionById } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/billing/subscriptions/:id/cancel` → Nest
 * `POST /v1/billing/subscriptions/:id/cancel` (exige `billing.manage`).
 * Repassa `Idempotency-Key` (PROJECT §5); gera uma se ausente.
 * TODO(backend pronto): este stub sai — proxy integral abaixo assume.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const body = (await req.json().catch(() => ({}))) as { motivo?: string; confirmacao?: boolean };
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();

  if (API_INTERNAL_URL) {
    // Nest responde a linha atualizada; BFF estabiliza `{subscriptionId, status, auditId}`.
    const upstream = await fetch(
      `${API_INTERNAL_URL}/v1/billing/subscriptions/${encodeURIComponent(params.id)}/cancel`,
      {
        method: "POST",
        headers: {
          ...upstreamAuthJsonHeaders(session),
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ reason: body.motivo }),
      },
    );
    const data = (await upstream.json().catch(() => ({}))) as { id?: string; status?: string };
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    const auditId = newKey();
    const res = NextResponse.json({ subscriptionId: data.id ?? params.id, status: data.status, auditId });
    res.headers.set("X-Aurum-Audit", auditId);
    return res;
  }

  const sub = mockSubscriptionById(params.id);
  if (!sub) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Assinatura não encontrada." }, { status: 404 });
  }
  if (sub.status === "CANCELLED" || sub.status === "EXPIRED") {
    return NextResponse.json(
      { code: "INVALID_TRANSITION", message: "Assinatura já encerrada." },
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
  const res = NextResponse.json({ subscriptionId: params.id, status: "CANCELLED", auditId });
  res.headers.set("X-Aurum-Audit", auditId);
  return res;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
