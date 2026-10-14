import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import { mockProductByCode } from "@/lib/mocks";
import type { BillingInterval } from "@/lib/types";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

interface NestPlan {
  id?: string;
  productCode?: string;
  code?: string;
  name?: string;
  priceCents?: number;
  billingInterval?: string;
  validFrom?: string;
  validTo?: string | null;
  status?: string;
  supersededBy?: string | null;
}

interface NestImage {
  id?: string;
  filename?: string;
  originalName?: string;
  mime?: string;
  size?: number;
  url?: string;
  createdAt?: string;
}

/**
 * BFF `GET /api/products/:code` → Nest `GET /v1/products/:code` + planos.
 * Compõe o detalhe admin (produto + planos versionados + galeria):
 * - planos vêm de `GET /v1/plans?productCode=&status=ALL` (linhas DRAFT entram
 *   no histórico como não-vigentes);
 * - imagens do Nest trazem `url` do backend — reescritas p/ o proxy do BFF
 *   (`/api/products/:code/images/:id`, mesma origem — CSP `img-src 'self'`).
 * 404 sem PII. TODO(backend pronto): remover stub — composição abaixo assume.
 */
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (API_INTERNAL_URL) {
    try {
      const headers = upstreamAuthHeaders(session);
      const [productRes, plansRes] = await Promise.all([
        fetch(`${API_INTERNAL_URL}/v1/products/${encodeURIComponent(params.code)}`, { headers }),
        fetch(
          `${API_INTERNAL_URL}/v1/plans?productCode=${encodeURIComponent(params.code)}&status=ALL`,
          { headers },
        ),
      ]);
      const productData = (await productRes.json().catch(() => ({}))) as {
        id?: string;
        code?: string;
        images?: NestImage[];
      } & Record<string, unknown>;
      if (!productRes.ok || !productData.id) {
        return NextResponse.json(productData, { status: productRes.status });
      }
      const plansData = (await plansRes.json().catch(() => [])) as NestPlan[] | { data?: NestPlan[] };
      const planRows = Array.isArray(plansData) ? plansData : (plansData.data ?? []);
      return NextResponse.json({
        ...productData,
        plans: planRows.map((p) => ({
          id: p.id,
          productId: productData.id,
          name: p.name,
          billingInterval: (p.billingInterval === "MONTH" || p.billingInterval === "YEAR"
            ? p.billingInterval
            : "MONTH") as BillingInterval,
          priceCents: p.priceCents ?? 0,
          currency: "BRL",
          status: p.status === "ACTIVE" ? "ATIVO" : "SUBSTITUIDO",
          validFrom: p.validFrom,
          validTo: p.validTo ?? null,
          supersededBy: p.supersededBy ?? null,
        })),
        gallery: (productData.images ?? []).map((img) => ({
          id: img.id,
          name: img.originalName ?? img.filename,
          size: img.size ?? 0,
          previewUrl: `/api/products/${encodeURIComponent(params.code)}/images/${encodeURIComponent(img.id ?? "")}`,
          sessao: false,
        })),
      });
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
  return NextResponse.json(product);
}
