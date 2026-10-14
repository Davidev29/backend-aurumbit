import type { BillingInterval, PlanView, ProductView } from "@/types";

const BILLING: BillingInterval[] = ["MONTH", "YEAR", "ONE_TIME"];

function toBillingInterval(raw: unknown): BillingInterval {
  return typeof raw === "string" && (BILLING as string[]).includes(raw)
    ? (raw as BillingInterval)
    : "ONE_TIME";
}

interface NestPlan {
  id: string;
  productCode?: string;
  code?: string;
  name: string;
  priceCents: number;
  billingInterval?: unknown;
  validFrom?: string;
  validTo?: string | null;
  status?: string;
  supersededBy?: string | null;
  features?: Array<{ featureCode?: string; featureName?: string }>;
}

interface NestProduct {
  id: string;
  code: string;
  name: string;
  slug?: string;
  description?: string | null;
  shortDescription?: string;
  status?: string;
  machinesAllowed?: number | null;
  category?: string;
  gallery?: unknown;
  images?: Array<{ id?: string; url: string; alt?: string; name?: string }>;
  createdAt?: string;
}

/**
 * Normaliza o catálogo do Nest para `ProductView` (resiliência: o Nest não
 * garante `plans[]`/`gallery` — sem isso os cards quebrariam em runtime).
 */
export function mapNestPlans(rows: NestPlan[]): Map<string, PlanView[]> {
  const byCode = new Map<string, PlanView[]>();
  for (const p of rows) {
    const plan: PlanView = {
      id: String(p.id),
      productId: "",
      name: p.name,
      billingInterval: toBillingInterval(p.billingInterval),
      priceCents: Number(p.priceCents) || 0,
      currency: "BRL" as const,
      status: p.status === "ACTIVE" ? ("ATIVO" as const) : ("DRAFT" as const),
      validFrom: p.validFrom ?? new Date().toISOString(),
      validTo: p.validTo ?? null,
      supersededBy: p.supersededBy ?? null,
      features: (p.features ?? []).map((f) => ({
        featureCode: f.featureName ?? f.featureCode ?? "",
      })),
    };
    const list = byCode.get(p.productCode ?? "") ?? [];
    list.push(plan);
    byCode.set(p.productCode ?? "", list);
  }
  return byCode;
}

export function mapNestProducts(
  rows: NestProduct[],
  plansByCode: Map<string, PlanView[]>
): ProductView[] {
  return rows.map((r) => {
    const gallery = Array.isArray(r.images)
      ? r.images.map((img, i) => ({
          id: img.id ?? `${r.code}-img-${i}`,
          name: img.name ?? img.alt ?? r.name,
          size: 0,
          url: img.url,
          alt: img.alt ?? r.name,
          order: i,
        }))
      : [];
    return {
      id: String(r.id),
      code: r.code,
      name: r.name,
      slug: r.slug ?? r.code,
      description: r.description ?? "",
      shortDescription: r.shortDescription,
      status: r.status === "ACTIVE" ? "ACTIVE" : "DRAFT",
      machinesAllowed: r.machinesAllowed ?? 1,
      plans: plansByCode.get(r.code) ?? [],
      gallery,
      category: r.category,
      createdAt: r.createdAt ?? new Date().toISOString(),
    };
  });
}
