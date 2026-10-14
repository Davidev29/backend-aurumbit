import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockCatalogPage } from "@/lib/mocks";
import { fetchCatalogFromUpstream, filterCatalogPage } from "@/lib/catalog";
import {
  UpstreamStatusError,
  resolveUpstream,
  upstreamUnavailableResponse,
} from "@/lib/upstream";

/**
 * BFF `GET /api/products?q=&category=` → Nest `GET /v1/products` (leitura aberta).
 * Fail-closed: sem `API_INTERNAL_URL` em produção responde 502 UPSTREAM_MISSING
 * (nunca mock silencioso). Stub local só em dev.
 */
export async function GET(req: NextRequest) {
  const resolved = resolveUpstream();
  if (resolved.kind === "missing") return resolved.response;

  if (resolved.kind === "upstream") {
    try {
      const items = await fetchCatalogFromUpstream(resolved.base);
      const q = req.nextUrl.searchParams;
      const filtered = filterCatalogPage(items, q.get("q") ?? "", q.get("category"));
      return NextResponse.json({
        data: filtered,
        meta: { nextCursor: null, limit: filtered.length },
      });
    } catch (err) {
      if (err instanceof UpstreamStatusError) {
        return NextResponse.json(err.body, { status: err.status });
      }
      return upstreamUnavailableResponse();
    }
  }

  const q = req.nextUrl.searchParams;
  return NextResponse.json(
    mockCatalogPage(q.get("q") ?? "", q.get("category"))
  );
}
