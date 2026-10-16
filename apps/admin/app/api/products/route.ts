import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders, upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockCreateProduct, mockProductPage } from "@/lib/mocks";
import type { ProductView } from "@/lib/types";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

function slugifyBase(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "produto"
  );
}

function upstreamUnavailable(): NextResponse {
  // DS §11 (anti-mock): falha real NUNCA cai em stub silencioso.
  return NextResponse.json(
    { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
    { status: 502 },
  );
}

/**
 * BFF `GET /api/products?q=&cursor=` → Nest `GET /v1/products` (catálogo).
 * Stub: `mockProductPage` (filtro por nome, cursor por id).
 * Normaliza o upstream (array puro, sem `plans`/`gallery`) p/ `Page<ProductView>`:
 * - anexa planos vigentes (`GET /v1/plans?status=ALL`, 1 chamada p/ a lista);
 * - filtra por `q` (nome/código/slug — o Nest ignora o parâmetro);
 * - `gallery` segue vazia na lista (detalhe compõe via `[code]`).
 * TODO(backend pronto): remover stub — proxy integral abaixo assume.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;

  if (API_INTERNAL_URL) {
    try {
      // Planos exigem Bearer (global `JwtAuthGuard`) — cookie sozinho dá 401.
      const headers = upstreamAuthHeaders(session);
      const [productsRes, plansRes] = await Promise.all([
        fetch(`${API_INTERNAL_URL}/v1/products?${q.toString()}`, { headers }),
        fetch(`${API_INTERNAL_URL}/v1/plans?status=ALL`, { headers }),
      ]);
      const productsData = (await productsRes.json().catch(() => [])) as
        | Array<Record<string, unknown>>
        | { data?: Array<Record<string, unknown>> };
      if (!productsRes.ok || !Array.isArray(Array.isArray(productsData) ? productsData : productsData.data)) {
        return NextResponse.json(productsData, { status: productsRes.status });
      }
      const rows = Array.isArray(productsData) ? productsData : (productsData.data ?? []);
      const plansData = (await plansRes.json().catch(() => [])) as
        | Array<Record<string, unknown>>
        | { data?: Array<Record<string, unknown>> };
      const planRows = Array.isArray(plansData) ? plansData : (plansData.data ?? []);
      const byProduct = new Map<string, ProductView["plans"]>();
      for (const p of planRows) {
        const pid = typeof p.productId === "string" ? p.productId : null;
        if (!pid) continue;
        const interval = p.billingInterval === "MONTH" || p.billingInterval === "YEAR" ? p.billingInterval : "MONTH";
        const entry: ProductView["plans"][number] = {
          id: typeof p.id === "string" ? p.id : `${pid}-${String(interval)}`,
          productId: pid,
          name: typeof p.name === "string" ? p.name : String(interval),
          billingInterval: interval,
          priceCents: typeof p.priceCents === "number" ? p.priceCents : 0,
          currency: "BRL",
          status: p.status === "ACTIVE" ? "ATIVO" : "SUBSTITUIDO",
          validFrom: typeof p.validFrom === "string" ? p.validFrom : new Date().toISOString(),
          validTo: typeof p.validTo === "string" ? p.validTo : null,
          supersededBy: typeof p.supersededBy === "string" ? p.supersededBy : null,
        };
        const list = byProduct.get(pid) ?? [];
        list.push(entry);
        byProduct.set(pid, list);
      }
      const term = (q.get("q") ?? "").trim().toLowerCase();
      const data: ProductView[] = rows
        .filter((r) => {
          if (!term) return true;
          const hay = `${String(r.name ?? "")} ${String(r.code ?? "")} ${String(r.slug ?? "")}`.toLowerCase();
          return hay.includes(term);
        })
        .map((r) => {
          const id = typeof r.id === "string" ? r.id : String(r.code ?? "");
          const st = r.status === "DRAFT" || r.status === "ARCHIVED" ? r.status : "ACTIVE";
          return {
            id,
            code: String(r.code ?? ""),
            name: String(r.name ?? ""),
            slug: String(r.slug ?? ""),
            description: typeof r.description === "string" ? r.description : null,
            status: st,
            machinesAllowed: typeof r.machinesAllowed === "number" ? r.machinesAllowed : 3,
            plans: byProduct.get(id) ?? [],
            gallery: [],
            createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
          } satisfies ProductView;
        });
      const limit = Number(q.get("limit")) || 20;
      return NextResponse.json({ data, meta: { nextCursor: null, limit } });
    } catch {
      return upstreamUnavailable();
    }
  }

  return NextResponse.json(
    mockProductPage(q.get("q") ?? "", q.get("cursor"), Number(q.get("limit")) || 20),
  );
}

/**
 * BFF `POST /api/products` → Nest `POST /v1/products` (exige `product.manage`).
 * Valida nome ≥ 3, machinesAllowed 1..100, preços ≥ 0; code único → 409 CONFLICT.
 * TODO(backend Fase 7): estender o catálogo real com machinesAllowed/planos/galeria
 * (o Nest atual só persiste code/name/slug/description — o BFF deriva code/slug
 * quando omitidos e repassa o corpo integral p/ forward-compat).
 */
export async function POST(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    code?: unknown;
    slug?: unknown;
    description?: unknown;
    machinesAllowed?: unknown;
    monthlyPriceCents?: unknown;
    annualPriceCents?: unknown;
    gallery?: unknown;
  };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 3) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Nome deve ter ao menos 3 caracteres." },
      { status: 422 },
    );
  }
  // Espelha o `@MaxLength(500)` do Nest (`CreateProductDto.description`):
  // sem esta trava o upstream devolve 400 com `message` em array.
  if (typeof body.description === "string" && body.description.trim().length > 500) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Descrição deve ter no máximo 500 caracteres." },
      { status: 422 },
    );
  }
  if (
    typeof body.machinesAllowed !== "number" ||
    !Number.isInteger(body.machinesAllowed) ||
    body.machinesAllowed < 1 ||
    body.machinesAllowed > 100
  ) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "machinesAllowed deve ser inteiro entre 1 e 100." },
      { status: 422 },
    );
  }
  for (const field of ["monthlyPriceCents", "annualPriceCents"] as const) {
    const v = body[field];
    if (v !== null && v !== undefined && (typeof v !== "number" || v < 0)) {
      return NextResponse.json(
        { code: "UNPROCESSABLE", message: `Preço ${field} deve ser ≥ 0.` },
        { status: 422 },
      );
    }
  }

  if (API_INTERNAL_URL) {
    // Real: cria o produto e, em seguida, as linhas de plano (mensal/anual).
    // Nest `CreateProductDto` é whitelist estrita — envia SÓ os campos do DTO;
    // planos vão em `POST /v1/plans` + `POST /v1/plans/:id/activate` (create
    // insere DRAFT). Galeria vai por multipart em `/api/products/:code/images`.
    const headers = {
      ...upstreamAuthJsonHeaders(session),
      "Idempotency-Key": key,
    };
    try {
      // O Nest exige code/slug — deriva como o stub quando omitidos.
      // Convenção canônica: code UPPER_SNAKE (ex. AURUM_TERMINAL, ver
      // prisma/products/schema.prisma) + slug lower-kebab. Sem toLowerCase
      // cego no code (case-sensitive no PG: WHERE code=$1).
      const ts = Date.now();
      const base = slugifyBase(name);
      const suffix = ts.toString(36).slice(-4);
      const rawCode = typeof body.code === "string" && body.code.trim() ? body.code.trim() : `${base}-${suffix}`;
      const rawSlug = typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : `${base}-${suffix}`;
      const code = rawCode.toUpperCase().replace(/-/g, "_").slice(0, 64);
      const slug = rawSlug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 120);
      const created = await fetch(`${API_INTERNAL_URL}/v1/products`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          code,
          name,
          slug,
          ...(typeof body.description === "string" ? { description: body.description } : {}),
          machinesAllowed: body.machinesAllowed,
        }),
      });
      const createdData = await created.json().catch(() => ({}));
      if (!created.ok) {
        return NextResponse.json(createdData, { status: created.status });
      }
      // Planos: uma linha por ciclo informado (preço congelado na linha).
      const plans: unknown[] = [];
      const planWarnings: unknown[] = [];
      const cycles = [
        { cents: body.monthlyPriceCents, interval: "MONTH", label: "Mensal" },
        { cents: body.annualPriceCents, interval: "YEAR", label: "Anual" },
      ] as const;
      for (const c of cycles) {
        if (typeof c.cents !== "number" || c.cents <= 0) continue;
        try {
          const planRes = await fetch(`${API_INTERNAL_URL}/v1/plans`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              productCode: code,
              code: `${code}-${c.interval.toLowerCase()}`,
              name: `${name} ${c.label}`,
              priceCents: Math.round(c.cents),
              billingInterval: c.interval,
              validFrom: new Date().toISOString(),
            }),
          });
          const planData = (await planRes.json().catch(() => ({}))) as { id?: string };
          if (!planRes.ok || !planData.id) {
            planWarnings.push({ interval: c.interval, upstream: planData });
            continue;
          }
          await fetch(`${API_INTERNAL_URL}/v1/plans/${encodeURIComponent(planData.id)}/activate`, {
            method: "POST",
            headers,
          }).catch(() => null);
          plans.push(planData);
        } catch {
          planWarnings.push({ interval: c.interval, code: "UPSTREAM_UNAVAILABLE" });
        }
      }
      return NextResponse.json({ ...(createdData as Record<string, unknown>), plans, planWarnings }, { status: 201 });
    } catch {
      return upstreamUnavailable();
    }
  }

  try {
    const product = mockCreateProduct({
      name,
      code: typeof body.code === "string" ? body.code : undefined,
      slug: typeof body.slug === "string" ? body.slug : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      machinesAllowed: body.machinesAllowed as number,
      monthlyPriceCents: (body.monthlyPriceCents as number | null | undefined) ?? null,
      annualPriceCents: (body.annualPriceCents as number | null | undefined) ?? null,
      gallery: Array.isArray(body.gallery)
        ? (body.gallery as Array<{ name: string; size: number }>)
        : [],
    });
    return NextResponse.json(product, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "CONFLICT") {
      return NextResponse.json(
        { code: "CONFLICT", message: "product code/slug já existe" },
        { status: 409 },
      );
    }
    throw err;
  }
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
