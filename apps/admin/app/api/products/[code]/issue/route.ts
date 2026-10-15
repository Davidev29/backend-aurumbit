import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockIssueProductLicense, mockProductByCode } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/products/:code/issue` → Nest `POST /v1/licenses` (issue).
 * Emite licença p/ customerId + planId. Chave NUNCA em plaintext na resposta —
 * só `keyMasked` (entrega/auditoria via reveal, PROJECT §2); o `key` do
 * upstream real é descartado aqui.
 * Mapeamento real: `{ ownerType: "CUSTOMER", ownerId: customerId,
 * productId: <code do produto, id opaco cross-schema>, planId, kind }`.
 * TODO(backend pronto): remover stub — proxy abaixo assume.
 */
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();
  const body = (await req.json().catch(() => ({}))) as {
    customerId?: unknown;
    planId?: unknown;
    kind?: unknown;
  };

  if (typeof body.customerId !== "string" || body.customerId.trim().length === 0) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "customerId é obrigatório." },
      { status: 422 },
    );
  }
  if (typeof body.planId !== "string" || body.planId.trim().length === 0) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "planId é obrigatório." },
      { status: 422 },
    );
  }
  // A UI passa `PlanView.billingInterval` (`MONTH`/`YEAR`); o Nest real espera
  // `monthly`/`annual` — normaliza aqui (stub ignora o kind).
  const rawKind = typeof body.kind === "string" ? body.kind.toLowerCase() : "";
  const kind = rawKind === "month" ? "monthly" : rawKind === "year" ? "annual" : rawKind;
  if (kind !== "monthly" && kind !== "annual") {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "kind deve ser monthly ou annual." },
      { status: 422 },
    );
  }

  if (API_INTERNAL_URL) {
    // Core `IssueLicenseDto` (whitelist estrita): {ownerType, ownerId,
    // productId, planId?, contractItemId?, kind monthly|annual, startsAt?,
    // ownerLabel?}. Resposta `{license: MaskedLicense, key}` — o plaintext é
    // descartado (entrega via reveal auditado).
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/licenses`, {
        method: "POST",
        headers: {
          ...upstreamAuthJsonHeaders(session),
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          ownerType: "CUSTOMER",
          ownerId: body.customerId,
          productId: params.code,
          planId: body.planId,
          kind,
        }),
      });
      const data = (await upstream.json().catch(() => ({}))) as {
        license?: { id?: string; keyMasked?: string };
      };
      if (!upstream.ok) {
        return NextResponse.json(data, { status: upstream.status });
      }
      // Descarta o `key` plaintext do upstream (entrega via reveal auditado).
      const auditId = newKey();
      const res = NextResponse.json({
        licenseId: data.license?.id,
        keyMasked: data.license?.keyMasked,
        auditId,
      });
      res.headers.set("X-Aurum-Audit", auditId);
      return res;
    } catch {
      // DS §11 (anti-mock): falha real NUNCA cai em stub silencioso.
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
  }

  const product = mockProductByCode(params.code);
  if (!product) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Produto não encontrado." }, { status: 404 });
  }
  return NextResponse.json(
    mockIssueProductLicense(params.code, {
      customerId: body.customerId as string,
      planId: body.planId as string,
      kind: kind as "monthly" | "annual",
    }),
    { status: 201 },
  );
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
