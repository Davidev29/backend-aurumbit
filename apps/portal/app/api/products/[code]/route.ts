import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockProductByCode } from "@/lib/mocks";
import { mapNestPlans, mapNestProducts } from "@/lib/nest-catalog";
import { resolveUpstream, upstreamUnavailableResponse } from "@/lib/upstream";

/**
 * GET /api/products/:code — detalhe do produto (leitura aberta), com planos.
 * Fail-closed: sem upstream em produção → 502 (nunca mock silencioso).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { code: string } }
) {
  const code = decodeURIComponent(params.code);

  const resolved = resolveUpstream();
  if (resolved.kind === "missing") return resolved.response;

  if (resolved.kind === "upstream") {
    const base = resolved.base;
    try {
      const [productRes, plansRes] = await Promise.all([
        fetch(`${base}/v1/products/${encodeURIComponent(code)}`, {
          next: { revalidate: 60 },
        }),
        fetch(`${base}/v1/products/${encodeURIComponent(code)}/plans`, {
          next: { revalidate: 60 },
        }).catch(() => null),
      ]);
      const data = await productRes.json().catch(() => ({}));
      if (!productRes.ok) return NextResponse.json(data, { status: productRes.status });
      const plans = plansRes?.ok
        ? ((await plansRes.json().catch(() => [])) as Array<Record<string, unknown>>)
        : [];
      const plansByCode = mapNestPlans(plans as never[]);
      const [mapped] = mapNestProducts([data] as never[], plansByCode);
      if (mapped) {
        for (const plan of mapped.plans) {
          if (!plan.productId) plan.productId = mapped.id;
        }
        return NextResponse.json(mapped);
      }
      return NextResponse.json(data, { status: productRes.status });
    } catch {
      return upstreamUnavailableResponse();
    }
  }

  const product = mockProductByCode(code);
  if (!product) {
    return NextResponse.json(
      { code: "NOT_FOUND", message: "Produto não encontrado." },
      { status: 404 }
    );
  }
  return NextResponse.json(product);
}
