import { mapNestPlans, mapNestProducts } from "@/lib/nest-catalog";
import { UpstreamStatusError } from "@/lib/upstream";
import type { ProductView } from "@/types";

interface NestProductRow {
  id: string;
  code: string;
}

/**
 * Busca o catálogo no Nest e normaliza para `ProductView`.
 * Lança `UpstreamStatusError` (status + corpo do Nest) ou erro de rede.
 * Usado pelo BFF `GET /api/products` e pelo SSR da landing (sem duplicação).
 */
export async function fetchCatalogFromUpstream(base: string): Promise<ProductView[]> {
  const query = "";
  const [productsRes, plansRes] = await Promise.all([
    fetch(`${base}/v1/products?${query}`, {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 60 },
    }),
    fetch(`${base}/v1/products/plans/all`, {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 60 },
    }).catch(() => null),
  ]);

  if (!productsRes.ok) {
    throw new UpstreamStatusError(productsRes.status, await productsRes.json().catch(() => ({})));
  }

  const products = (await productsRes.json().catch(() => [])) as NestProductRow[];
  const plans = plansRes?.ok
    ? ((await plansRes.json().catch(() => [])) as Array<Record<string, unknown>>)
    : [];
  const list = Array.isArray(products) ? products : [];
  const plansByCode = mapNestPlans(plans as never[]);
  const idByCode = new Map(list.map((p) => [p.code, String(p.id)]));
  plansByCode.forEach((group, code) => {
    for (const plan of group) {
      plan.productId = idByCode.get(code) ?? plan.productId;
    }
  });
  return mapNestProducts(list as never[], plansByCode);
}

/** Filtro `q` + `category` idêntico ao do BFF (vitrine SSR = vitrine BFF). */
export function filterCatalogPage(
  items: ProductView[],
  q: string,
  category: string | null
): ProductView[] {
  const needle = q.toLowerCase();
  return items.filter(
    (p) =>
      (!needle || p.name.toLowerCase().includes(needle)) &&
      (!category || p.category === category)
  );
}
