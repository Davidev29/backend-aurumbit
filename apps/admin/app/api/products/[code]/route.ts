import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders, upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockProductByCode, mockWriteProduct } from "@/lib/mocks";
import {
  PRODUCT_DELIVERY_MODES,
  PRODUCT_PLATFORM_IDS,
  normalizePlatformIds,
  type ProductDeliveryMode,
  type ProductPlatformId,
} from "@/lib/platforms";
import type { BillingInterval, ProductWriteResponse } from "@/lib/types";

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

/** Slug = URL pública (SEO). Mesmo regex do `PRODUCT_SLUG_PATTERN` do Nest. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAX_DESCRIPTION = 500;

/**
 * Campos editáveis — a MESMA lista branca do Nest (`WRITABLE_COLUMNS` em
 * `products.service.ts`). O BFF nunca repassa chave fora daqui: ela é
 * descartada antes do proxy (defesa em profundidade) e recusada com 422
 * abaixo, para o operador não achar que salvou um campo que não existe.
 */
const EDITABLE_FIELDS = [
  "name",
  "slug",
  "description",
  "machinesAllowed",
  "platforms",
  "deliveryMode",
] as const;

/**
 * Campos PROIBIDOS, com o mesmo motivo do DTO (`PRODUCT_IMMUTABLE_FIELDS`).
 * `code`: licenças emitidas e contratos gravam o code — renomear deixa
 * órfãs todas as licenças. `status`: arquivar tem endpoint próprio. Preço:
 * catálogo imutável (nova linha de plano).
 */
const FORBIDDEN_FIELDS: Record<string, string> = {
  code: "code é imutável: licenças emitidas e contratos gravam o code do produto. Renomear deixa órfãs todas as licenças — crie um produto novo.",
  status: "status não é editado aqui: use Arquivar (destrutivo, com confirmação).",
  priceCents: "preço é imutável por linha de catálogo: use Alterar preço (nova linha).",
  monthlyPriceCents: "preço é imutável por linha de catálogo: use Alterar preço (nova linha).",
  annualPriceCents: "preço é imutável por linha de catálogo: use Alterar preço (nova linha).",
};

function upstreamUnavailable(): NextResponse {
  // DS §11 (anti-mock): falha real NUNCA cai em stub silencioso.
  return NextResponse.json(
    { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
    { status: 502 },
  );
}

function unprocessable(message: string): NextResponse {
  return NextResponse.json({ code: "UNPROCESSABLE", message }, { status: 422 });
}

function planRowsOf(data: unknown): NestPlan[] {
  const rows = Array.isArray(data) ? data : ((data as { data?: NestPlan[] })?.data ?? []);
  return rows;
}

/**
 * Planos do Nest → `ProductView["plans"]`.
 *
 * Compartilhado por GET e pelas escritas: `PATCH`/`PUT` devolvem o detalhe
 * completo, então a UI atualiza a visão sem refazer fetch (e sem a lista
 * "pulando" para o valor antigo por um instante).
 */
function mapPlans(productId: string, planRows: NestPlan[]) {
  return planRows.map((p) => ({
    id: p.id ?? "",
    productId,
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
  }));
}

/** Imagens do Nest → galeria do admin (preview passa pelo proxy do BFF). */
function mapGallery(code: string, images: NestImage[]) {
  return images.map((img) => ({
    id: img.id ?? "",
    name: img.originalName ?? img.filename,
    size: img.size ?? 0,
    previewUrl: `/api/products/${encodeURIComponent(code)}/images/${encodeURIComponent(img.id ?? "")}`,
    sessao: false,
  }));
}

/**
 * Produto do Nest → `ProductView` (sem planos/galeria).
 *
 * `platforms`/`deliveryMode` passam pelo MESMO normalizador da listagem:
 * nunca vaza id fora do catálogo e `deliveryMode` fora de OFFLINE|HYBRID cai
 * no default do banco.
 */
function normalizeProduct(raw: Record<string, unknown>) {
  const rawPlatforms = raw.platforms;
  const rawDelivery = raw.deliveryMode;
  return {
    ...raw,
    platforms: normalizePlatformIds(Array.isArray(rawPlatforms) ? (rawPlatforms as string[]) : []),
    deliveryMode: (PRODUCT_DELIVERY_MODES as readonly string[]).includes(String(rawDelivery))
      ? (rawDelivery as ProductDeliveryMode)
      : "OFFLINE",
  };
}

/** Detalhe completo (produto + planos + galeria), como `GET /api/products/:code`. */
function composeDetail(code: string, product: Record<string, unknown>, planRows: NestPlan[]) {
  return {
    ...normalizeProduct(product),
    plans: mapPlans(String(product.id ?? ""), planRows),
    gallery: mapGallery(code, (product.images as NestImage[]) ?? []),
  };
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
      const planRows = planRowsOf(await plansRes.json().catch(() => []));
      return NextResponse.json(composeDetail(params.code, productData, planRows));
    } catch {
      // DS §11 (anti-mock): falha real NUNCA cai em stub silencioso.
      return upstreamUnavailable();
    }
  }

  const product = mockProductByCode(params.code);
  if (!product) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Produto não encontrado." }, { status: 404 });
  }
  return NextResponse.json(product);
}

/* ------------------------------------------------------------------ */
/* PATCH / PUT — atualização do produto (mesmo arquivo: rota dinâmica)  */
/* ------------------------------------------------------------------ */

type WriteMode = "PATCH" | "PUT";

/** Corpo já validado: só chaves da lista branca, já normalizadas. */
type EditablePayload = {
  name?: string;
  slug?: string;
  description?: string | null;
  machinesAllowed?: number;
  platforms?: ProductPlatformId[];
  deliveryMode?: ProductDeliveryMode;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validação do BFF (espelha o `ValidationPipe`/`assertWritableShape` do Nest).
 *
 * Existe aqui para três motivos, todos do mesmo tipo:
 * 1. a UI fala com o BFF, então a mensagem em pt-BR precisa chegar sem ida
 *    ao upstream;
 * 2. o corpo NUNCA é repassado cru — o que sai daqui tem só chaves da lista
 *    branca, já normalizadas (`platforms` em ordem canônica, números
 *    validados), então o Nest recebe exatamente o que a tela mostrou;
 * 3. o caminho de STUB aplica as MESMAS regras — senão o stub aceitaria o que
 *    o backend recusa, e o operador aprenderia a regra errada.
 *
 * `requireAll` = PUT: todo campo editável precisa estar presente (é o que
 * separa PUT de PATCH); ausente → 422 listando o que falta.
 */
function validateWrite(
  body: unknown,
  requireAll: boolean,
): { ok: true; payload: EditablePayload } | { ok: false; response: NextResponse } {
  if (!isPlainObject(body)) {
    return { ok: false, response: unprocessable("Corpo deve ser um objeto JSON com os campos do produto.") };
  }
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    const reason = FORBIDDEN_FIELDS[key];
    if (reason) return { ok: false, response: unprocessable(reason) };
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        response: unprocessable(
          `O campo "${key}" não pode ser editado em produto. Campos editáveis: ${EDITABLE_FIELDS.join(", ")}.`,
        ),
      };
    }
  }

  const present = EDITABLE_FIELDS.filter((key) => body[key] !== undefined);
  if (requireAll) {
    const missing = EDITABLE_FIELDS.filter((key) => body[key] === undefined);
    if (missing.length > 0) {
      return {
        ok: false,
        response: unprocessable(`Substituição total exige todos os campos; faltam: ${missing.join(", ")}.`),
      };
    }
  } else if (present.length === 0) {
    return {
      ok: false,
      response: unprocessable(`Informe ao menos um campo para alterar: ${EDITABLE_FIELDS.join(", ")}.`),
    };
  }

  const payload: EditablePayload = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 120) {
      return { ok: false, response: unprocessable("Nome deve ter entre 2 e 120 caracteres.") };
    }
    payload.name = name;
  }
  if (body.slug !== undefined) {
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    if (!SLUG_PATTERN.test(slug)) {
      return {
        ok: false,
        response: unprocessable(
          'O slug deve usar apenas letras minúsculas, números e hífen simples (ex.: "aurum-pro").',
        ),
      };
    }
    payload.slug = slug;
  }
  if (body.description !== undefined) {
    // `null` limpa a descrição (PUT); string passa com o teto do DTO (500).
    if (body.description === null) {
      payload.description = null;
    } else if (typeof body.description === "string") {
      if (body.description.length > MAX_DESCRIPTION) {
        return {
          ok: false,
          response: unprocessable(`Descrição deve ter no máximo ${MAX_DESCRIPTION} caracteres.`),
        };
      }
      // Invariante do dado: "sem descrição" é NULL, nunca "" (a UI trata os
      // dois como "Sem descrição cadastrada", mas guardar "" deixa o banco com
      // dois jeitos de dizer a mesma coisa).
      payload.description = body.description.trim() === "" ? null : body.description.trim();
    } else {
      return { ok: false, response: unprocessable("Descrição deve ser texto ou null.") };
    }
  }
  if (body.machinesAllowed !== undefined) {
    const m = body.machinesAllowed;
    if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 100) {
      return {
        ok: false,
        response: unprocessable("O limite de máquinas por licença deve ser um número inteiro entre 1 e 100."),
      };
    }
    payload.machinesAllowed = m;
  }
  if (body.platforms !== undefined) {
    if (!Array.isArray(body.platforms)) {
      return { ok: false, response: unprocessable("As plataformas devem ser enviadas como uma lista.") };
    }
    const unknown = body.platforms.find(
      (p) => typeof p !== "string" || !(PRODUCT_PLATFORM_IDS as readonly string[]).includes(p),
    );
    if (unknown !== undefined) {
      return {
        ok: false,
        response: unprocessable(
          `Plataforma inválida: ${String(unknown)}. Use ${PRODUCT_PLATFORM_IDS.join(", ")}.`,
        ),
      };
    }
    const platforms = normalizePlatformIds(body.platforms as string[]);
    // REGRA (rev. 2026-10-17, F-15): lista vazia é VÁLIDA no PATCH e INVÁLIDA
    // no PUT — o mesmo contrato do Nest (`products.service.ts:assertWritableValues`).
    //
    // PATCH é edição pontual: um produto em pré-venda pode legitimamente ficar
    // sem plataforma declarada, e forbidding isso deixaria o operador sem como
    // registrar "ainda roda em lugar nenhum". `[]` é o estado real que o banco
    // já guarda por default.
    // PUT é substituição total: quem substitui o produto inteiro precisa
    // declarar onde ele roda — igual ao POST /v1/products.
    if (platforms.length === 0 && requireAll) {
      return { ok: false, response: unprocessable("Escolha ao menos uma plataforma.") };
    }
    payload.platforms = platforms;
  }
  if (body.deliveryMode !== undefined) {
    // Fail-closed: NÃO normaliza valor fora do catálogo para OFFLINE — isso
    // gravaria uma escolha que o operador não fez.
    if (!(PRODUCT_DELIVERY_MODES as readonly string[]).includes(String(body.deliveryMode))) {
      return {
        ok: false,
        response: unprocessable(`Modo de entrega inválido. Use ${PRODUCT_DELIVERY_MODES.join(" ou ")}.`),
      };
    }
    payload.deliveryMode = body.deliveryMode as ProductDeliveryMode;
  }
  return { ok: true, payload };
}

/**
 * BFF `PATCH|PUT /api/products/:code` → Nest homônimo.
 *
 * `PATCH` = parcial (só o que veio muda). `PUT` = substituição total (todos
 * os campos obrigatórios; `description: null` limpa de propósito).
 *
 * Resposta: o `ProductDetail` do Nest remontado no MESMO shape de
 * `GET /api/products/:code` (produto + planos + galeria) — a UI aplica direto
 * na visão, sem refazer fetch nem piscar a lista atrás.
 *
 * Erro do upstream é repassado COM status e corpo (400/404/409/422), para a
 * tela mostrar a mensagem real ("slug já em uso") em vez de um genérico.
 * Erro de REDE → 502 `UPSTREAM_UNAVAILABLE`, nunca stub silencioso (DS §11).
 */
async function handleWrite(req: NextRequest, code: string, mode: WriteMode): Promise<NextResponse> {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();
  const body = await req.json().catch(() => null);

  const validated = validateWrite(body, mode === "PUT");
  if (!validated.ok) return validated.response;
  const payload = validated.payload;

  if (API_INTERNAL_URL) {
    const upstreamUrl = `${API_INTERNAL_URL}/v1/products/${encodeURIComponent(code)}`;
    const plansUrl = `${API_INTERNAL_URL}/v1/plans?productCode=${encodeURIComponent(code)}&status=ALL`;
    try {
      // Planos em paralelo: a escrita não toca linhas de plano, então a
      // leitura é a mesma antes/depois (no caminho de erro ela é descartada).
      const [writeRes, plansRes] = await Promise.all([
        fetch(upstreamUrl, {
          method: mode,
          headers: { ...upstreamAuthJsonHeaders(session), "Idempotency-Key": key },
          body: JSON.stringify(payload),
        }),
        fetch(plansUrl, { headers: upstreamAuthHeaders(session) }),
      ]);
      const data = (await writeRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!writeRes.ok) {
        // 400 (validação), 404 (code inexistente), 409 (slug em uso),
        // 422 (campo proibido) chegam com o corpo ORIGINAL do Nest.
        return NextResponse.json(data, { status: writeRes.status });
      }
      const planRows = planRowsOf(await plansRes.json().catch(() => []));
      // O `ProductDetail` do Nest (products.service.ts) é a fonte do shape;
      // a composição abaixo é a MESMA do GET, então a UI consome um só tipo.
      const detail = composeDetail(code, data, planRows) as ProductWriteResponse;
      return NextResponse.json({ ...detail, mode: "proxy" });
    } catch {
      return upstreamUnavailable();
    }
  }

  // Stub (sem `API_INTERNAL_URL`): grava SÓ em memória, marcado como sintético.
  const result = mockWriteProduct(code, payload, mode === "PUT");
  if (result.outcome === "not-found") {
    return NextResponse.json({ code: "NOT_FOUND", message: "Produto não encontrado." }, { status: 404 });
  }
  if (result.outcome === "conflict") {
    return NextResponse.json({ code: "CONFLICT", message: result.message }, { status: 409 });
  }
  return NextResponse.json({
    ...result.product,
    mode: "stub",
    notice:
      "API_INTERNAL_URL ausente — alteração gravada apenas na memória desta sessão (dados SINTÉTICOS, nada foi para o banco).",
  } satisfies ProductWriteResponse);
}

/** Atualização PARCIAL: só os campos enviados mudam. Idempotente. */
export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  return handleWrite(req, params.code, "PATCH");
}

/** Substituição TOTAL: todos os campos obrigatórios (400/422 lista o que falta). */
export async function PUT(req: NextRequest, { params }: { params: { code: string } }) {
  return handleWrite(req, params.code, "PUT");
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
