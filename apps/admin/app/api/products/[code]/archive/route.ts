import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockArchiveProduct } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/products/:code/archive` → Nest `POST /v1/products/:code/archive`.
 * Exige `product.manage` + confirmação explícita (`confirmacao: true` → 422 senão,
 * DestructiveForm na UI). `motivo` segue no corpo (audit trail, como
 * revoke/refund/cancel). Status ARCHIVED é terminal no backend.
 * Responde o produto + `auditId` (header `X-Aurum-Audit`).
 * TODO(RBAC real): sem helper de `me` no BFF — o stub infere a permissão da
 * sessão como `app/api/auth/me` (manager ↔ sem `product.manage`); o backend
 * real é a fonte (default deny, PROJECT §3).
 */
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();
  const body = (await req.json().catch(() => ({}))) as { motivo?: unknown; confirmacao?: unknown };

  if (body.confirmacao !== true) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Arquivamento exige confirmação explícita." },
      { status: 422 },
    );
  }

  if (API_INTERNAL_URL) {
    try {
      const upstream = await fetch(
        `${API_INTERNAL_URL}/v1/products/${encodeURIComponent(params.code)}/archive`,
        {
          method: "POST",
          headers: {
            ...upstreamAuthJsonHeaders(session),
            "Idempotency-Key": key,
          },
          body: JSON.stringify(body),
        },
      );
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return NextResponse.json(data, { status: upstream.status });
      }
      const auditId = newKey();
      const res = NextResponse.json({ ...(data as Record<string, unknown>), auditId });
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

  // Stub: mesma inferência de `app/api/auth/me` — sessão de manager NÃO tem `product.manage`.
  if (session.includes("u-manager-1")) {
    return NextResponse.json(
      { code: "FORBIDDEN", message: "Arquivamento exige product.manage." },
      { status: 403 },
    );
  }
  const product = mockArchiveProduct(params.code);
  if (!product) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Produto não encontrado." }, { status: 404 });
  }
  const auditId = newKey();
  const res = NextResponse.json({ ...product, auditId });
  res.headers.set("X-Aurum-Audit", auditId);
  return res;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
