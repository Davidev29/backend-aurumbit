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

interface NestMediaRow {
  id?: string;
  url?: string;
  filename?: string;
  alt?: string;
  name?: string;
  originalName?: string;
  mime?: string;
  type?: string;
  kind?: string;
  poster?: string;
  order?: number;
  createdAt?: string;
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
  images?: NestMediaRow[];
  videos?: NestMediaRow[];
  media?: NestMediaRow[];
  createdAt?: string;
}

const VIDEO_EXT = [".mp4", ".webm", ".mov", ".m4v", ".ogv"];
const VIDEO_MIME_PREFIX = "video/";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Detecta vídeo por mime ou extensão — o backend pode enviar `mime` ou só `url`. */
export function detectMediaKind(row: NestMediaRow): "image" | "video" {
  const mime = String(row.mime ?? row.type ?? row.kind ?? "").toLowerCase();
  if (mime.startsWith(VIDEO_MIME_PREFIX) || mime === "video") return "video";
  if (mime.startsWith("image/") || mime === "image") return "image";
  const url = String(row.url ?? row.filename ?? "").toLowerCase().split("?")[0];
  if (VIDEO_EXT.some((ext) => url.endsWith(ext))) return "video";
  return "image";
}

/** URL utilizável no browser: absoluta passa direto; `/v1/...` vira proxy same-origin. */
export function toProxiedMediaUrl(rawUrl: string): string {
  if (!isNonEmptyString(rawUrl)) return "";
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("/v1/product-images/")) {
    return `/api/product-images/${rawUrl.slice("/v1/product-images/".length)}`;
  }
  return rawUrl;
}

function normalizeMediaRow(
  row: NestMediaRow,
  fallbackName: string,
  code: string,
  index: number
): ProductView["gallery"][number] | null {
  const filename = isNonEmptyString(row.url)
    ? row.url
    : isNonEmptyString(row.filename)
      ? `/v1/product-images/${row.filename.replace(/^\/+/, "")}`
      : "";
  if (!isNonEmptyString(filename)) return null;
  const kind = detectMediaKind(row);
  const order = Number.isFinite(Number(row.order)) ? Number(row.order) : index;
  return {
    id: String(row.id ?? `${code}-media-${index}`),
    name: row.name ?? row.originalName ?? row.alt ?? fallbackName,
    size: 0,
    url: toProxiedMediaUrl(filename),
    alt: row.alt ?? fallbackName,
    order,
    kind,
    mime: isNonEmptyString(row.mime) ? row.mime : undefined,
    poster: isNonEmptyString(row.poster) ? toProxiedMediaUrl(row.poster) : undefined,
  };
}

/** Junta `images` + `videos` + `media` + `gallery` genérico, ordenado por `order`. */
export function mapNestGallery(r: NestProduct): ProductView["gallery"] {
  const pools: NestMediaRow[] = [];
  if (Array.isArray(r.images)) pools.push(...r.images);
  if (Array.isArray(r.videos)) pools.push(...r.videos);
  if (Array.isArray(r.media)) pools.push(...r.media);
  if (Array.isArray(r.gallery)) pools.push(...(r.gallery as NestMediaRow[]));
  const items = pools
    .map((row, i) => normalizeMediaRow(row, r.name, r.code, i))
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .filter((x) => isNonEmptyString(x.url));
  items.sort((a, b) => a.order - b.order);
  return items.map((item, i) => ({ ...item, order: i }));
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
    const gallery = mapNestGallery(r);
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
