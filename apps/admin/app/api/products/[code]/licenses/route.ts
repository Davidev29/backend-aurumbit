import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import { mockProductByCode, mockProductLicenses } from "@/lib/mocks";
import type { LicenseEffectiveStatus, ProductLicensesPage } from "@/lib/types";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/** Teto do upstream (`ProductLicensesQueryDto`, `@Max(200)`). */
const MAX_LIMIT = 200;

/** Status EFETIVOS aceitos no filtro (`LICENSE_EFFECTIVE_STATUSES` do Nest). */
const STATUSES: readonly string[] = [
  "active",
  "grace",
  "expired",
  "suspended",
  "revoked",
  "pending_payment",
];

/**
 * BFF `GET /api/products/:code/licenses?limit=&offset=&status=`
 *   → Nest `GET /v1/products/:code/licenses` (Lane B).
 *
 * POR QUE ESTA ROTA: o histórico (`/v1/licenses/:id/history`) responde "o que
 * aconteceu com esta chave"; esta responde "como estão as chaves deste produto
 * AGORA". O modal de produto só tinha a primeira — daí chave vencida aparecer
 * como "Ativa". As duas são coisas diferentes e as duas ficam disponíveis.
 *
 * `status` filtra NO SQL upstream (`statusSqlPredicate`) e é reconfirmado em JS
 * lá — a página nunca vem com item de outro status. O BFF só repassa; a
 * validação de limite/status aqui é para não gastar chamada com query inválida.
 *
 * Anti-mock (DS §11 / A-MOCK-001):
 * - `API_INTERNAL_URL` presente → proxy, com `upstreamAuthHeaders`;
 * - erro de REDE → **502 `UPSTREAM_UNAVAILABLE`**, nunca stub silencioso;
 * - `API_INTERNAL_URL` AUSENTE → stub marcado com `mode:"stub"` + aviso, para
 *   a UI dizer na tela que os dados são sintéticos.
 */
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;

  const rawLimit = Number(q.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(Math.trunc(rawLimit), MAX_LIMIT) : 50;
  const rawOffset = Number(q.get("offset"));
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.trunc(rawOffset) : 0;
  const rawStatus = (q.get("status") ?? "").trim().toLowerCase();
  if (rawStatus && !STATUSES.includes(rawStatus)) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: `Status inválido: use ${STATUSES.join("|")}.` },
      { status: 422 },
    );
  }
  const status = (rawStatus || undefined) as LicenseEffectiveStatus | undefined;

  if (API_INTERNAL_URL) {
    const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) search.set("status", status);
    try {
      const upstream = await fetch(
        `${API_INTERNAL_URL}/v1/products/${encodeURIComponent(params.code)}/licenses?${search.toString()}`,
        { headers: upstreamAuthHeaders(session) },
      );
      const data = (await upstream.json().catch(() => ({}))) as Partial<ProductLicensesPage>;
      if (!upstream.ok) {
        return NextResponse.json(data, { status: upstream.status });
      }
      return NextResponse.json({
        items: Array.isArray(data.items) ? data.items : [],
        total: typeof data.total === "number" ? data.total : 0,
        limit: typeof data.limit === "number" ? data.limit : limit,
        offset: typeof data.offset === "number" ? data.offset : offset,
        hasMore: data.hasMore === true,
        mode: "proxy" as const,
      } satisfies ProductLicensesPage);
    } catch {
      // DS §11 (anti-mock): falha real NUNCA cai em stub silencioso.
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
  }

  // Stub (sem `API_INTERNAL_URL`): dados SINTÉTICOS, marcados como tal.
  const product = mockProductByCode(params.code);
  if (!product) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Produto não encontrado." }, { status: 404 });
  }
  return NextResponse.json({
    ...mockProductLicenses(params.code, { limit, offset, status }),
    mode: "stub" as const,
    notice: "API_INTERNAL_URL ausente — chaves SINTÉTICAS de demonstração, não dados reais.",
  } satisfies ProductLicensesPage);
}
