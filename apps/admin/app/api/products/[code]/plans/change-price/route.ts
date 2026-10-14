import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders, upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockChangePlanPrice } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/products/:code/plans/change-price` → preço versionado.
 * Preço IMUTÁVEL (Nest `CreatePlanDto`: sem endpoint de update — novo preço
 * = nova linha; `ArchivePlanDto.supersededBy` aponta a sucessora).
 * Valida motivo ≥ 10 + confirmação explícita → 422 senão (como
 * revoke/refund/cancel/renew-replace).
 *
 * Real (`API_INTERNAL_URL`): `POST /v1/products/:code/plans` (nova linha) +
 * `POST /v1/plans/:id/archive` (`supersededBy` = nova linha) p/ fechar a
 * anterior; recebíveis de contrato fechado nunca mudam no backend.
 * Falha real → 502 UPSTREAM_UNAVAILABLE, nunca stub silencioso (DS §11).
 * TODO(backend pronto): propagação de recebíveis no Nest (hoje só o stub
 * atualiza `amount` + `priceNote` dos sem fatura); agregar `auditId` real.
 */
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();
  const body = (await req.json().catch(() => ({}))) as {
    billingInterval?: unknown;
    newPriceCents?: unknown;
    effectiveFrom?: unknown;
    motivo?: unknown;
    confirmacao?: unknown;
  };

  if (typeof body.motivo !== "string" || body.motivo.trim().length < 10) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Motivo deve ter ao menos 10 caracteres." },
      { status: 422 },
    );
  }
  if (body.confirmacao !== true) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Troca de preço exige confirmação explícita." },
      { status: 422 },
    );
  }

  if (API_INTERNAL_URL) {
    // Orquestração real: lista a linha ATIVA → cria a nova (`POST /v1/plans`,
    // `CreatePlanDto` exato) → arquiva a anterior (`supersededBy`) → ativa a
    // nova (`createPlan` insere DRAFT). Recebíveis de contrato fechado nunca
    // mudam no backend — `updatedReceivables` volta vazio (propagação real
    // acontece nas NOVAS cobranças, que citam a nova linha).
    const headers = {
      ...upstreamAuthJsonHeaders(session),
      "Idempotency-Key": key,
    };
    const fail = (code: string, message: string, status: number, extra?: Record<string, unknown>) =>
      NextResponse.json({ code, message, ...extra }, { status });
    try {
      const currentRes = await fetch(
        `${API_INTERNAL_URL}/v1/plans?productCode=${encodeURIComponent(params.code)}&status=ACTIVE`,
        { headers: upstreamAuthHeaders(session) },
      );
      const currentData = (await currentRes.json().catch(() => ({}))) as
        | Array<{ id?: string; billingInterval?: string; name?: string }>
        | { data?: Array<{ id?: string; billingInterval?: string; name?: string }> };
      if (!currentRes.ok) {
        return NextResponse.json(currentData, { status: currentRes.status });
      }
      const list = Array.isArray(currentData) ? currentData : (currentData.data ?? []);
      const current = list.find((p) => p.billingInterval === body.billingInterval) ?? null;
      if (!current?.id) {
        return fail("CONFLICT", "Nenhuma linha ATIVA para o ciclo informado.", 409);
      }
      if (typeof body.newPriceCents !== "number" || body.newPriceCents <= 0) {
        return fail("UNPROCESSABLE", "Novo preço deve ser maior que zero.", 422);
      }
      const created = await fetch(`${API_INTERNAL_URL}/v1/plans`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          productCode: params.code,
          code: `${params.code}-${String(body.billingInterval).toLowerCase()}-${Date.now().toString(36)}`,
          name: current.name,
          priceCents: Math.round(body.newPriceCents as number),
          billingInterval: body.billingInterval,
          validFrom: body.effectiveFrom,
        }),
      });
      const createdData = (await created.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      } & Record<string, unknown>;
      if (!created.ok || !createdData.id) {
        return NextResponse.json(createdData, { status: created.status });
      }
      const archived = await fetch(
        `${API_INTERNAL_URL}/v1/plans/${encodeURIComponent(current.id as string)}/archive`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ supersededBy: createdData.id }),
        },
      );
      if (!archived.ok) {
        const archivedData = await archived.json().catch(() => ({}));
        return fail(
          "UPSTREAM_UNAVAILABLE",
          "Nova linha criada, mas a anterior não foi fechada. Reconcile manualmente.",
          502,
          { plan: createdData, oldPlanId: current.id, upstream: archivedData },
        );
      }
      const activated = await fetch(
        `${API_INTERNAL_URL}/v1/plans/${encodeURIComponent(createdData.id as string)}/activate`,
        { method: "POST", headers },
      );
      const activatedData = (await activated.json().catch(() => ({}))) as Record<string, unknown>;
      if (!activated.ok) {
        return fail(
          "UPSTREAM_UNAVAILABLE",
          "Linha criada e anterior fechada, mas a ativação falhou. Reconcile manualmente.",
          502,
          { plan: createdData, oldPlanId: current.id, upstream: activatedData },
        );
      }
      const auditId = newKey();
      const res = NextResponse.json(
        {
          plan: createdData,
          oldPlanId: current.id,
          updatedReceivables: [],
          auditId,
        },
        { status: 201 },
      );
      res.headers.set("X-Aurum-Audit", auditId);
      return res;
    } catch {
      return fail("UPSTREAM_UNAVAILABLE", "Backend indisponível. Tente novamente.", 502);
    }
  }

  try {
    const result = mockChangePlanPrice(params.code, {
      billingInterval: body.billingInterval as "MONTH" | "YEAR",
      newPriceCents: body.newPriceCents as number,
      effectiveFrom: body.effectiveFrom as string,
      motivo: body.motivo as string,
      confirmacao: true,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const status =
      typeof (err as { status?: unknown }).status === "number"
        ? ((err as { status: number }).status as 404 | 409 | 422)
        : 422;
    const code =
      typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "UNPROCESSABLE";
    return NextResponse.json(
      { code, message: (err as Error).message },
      { status },
    );
  }
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
