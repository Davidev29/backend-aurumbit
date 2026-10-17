import { apiGet, apiPatch, apiPost, apiPut } from "./api/client";
import type {
  ArchiveProductRequest,
  CreateProductRequest,
  CreateProductResponse,
  IssueProductLicenseRequest,
  LicenseEffectiveStatus,
  LicenseHistoryEntry,
  Page,
  PlanPriceChangeRequest,
  PlanPriceChangeResult,
  ProductActiveClient,
  ProductImage,
  ProductLicensesPage,
  ProductView,
  ProductWriteResponse,
  RenewReplaceRequest,
  ReplaceProductRequest,
  UpdateProductRequest,
} from "./types";

/**
 * Produtos com licenças offline via BFF (`/api/products/*` →
 * Nest `/v1/products/*` quando `API_INTERNAL_URL` está configurado;
 * stub auditado em `lib/mocks.ts` senão).
 *
 * POSTs sempre carregam `Idempotency-Key` (PROJECT §5).
 */

function idempotencyHeaders(): Record<string, string> {
  const key =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { "Idempotency-Key": key };
}

function toQuery(params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function listProducts(q: string, cursor: string | null): Promise<Page<ProductView>> {
  return apiGet<Page<ProductView>>(
    `/api/products${toQuery({ q: q ?? undefined, cursor: cursor ?? undefined })}`,
  );
}

export function getProduct(code: string): Promise<ProductView> {
  return apiGet<ProductView>(`/api/products/${encodeURIComponent(code)}`);
}

/**
 * Criação de produto. O retorno inclui `plans`/`planWarnings` do BFF: quando
 * `planWarnings` vem preenchido, o produto EXISTE mas algum preço não virou
 * linha de catálogo — a UI precisa mostrar isso, senão mente "criado com
 * mensal R$ X" para um produto sem plano mensal.
 */
export function createProduct(req: CreateProductRequest): Promise<CreateProductResponse> {
  return apiPost<CreateProductResponse>("/api/products", req, { headers: idempotencyHeaders() });
}

/**
 * Atualização PARCIAL do produto (`PATCH /api/products/:code`).
 *
 * Só os campos enviados mudam; ausente = preservado (inclusive
 * `description`, que só é limpa quando vem `null` explícito). Idempotente.
 * `Idempotency-Key` segue o padrão dos outros POSTs (PROJECT §5).
 *
 * Erros que a UI trata por status: 409 = slug já em uso por outro produto;
 * 422 = campo proibido (code/status/preço) ou valor fora de faixa.
 */
export function patchProduct(
  code: string,
  req: UpdateProductRequest,
): Promise<ProductWriteResponse> {
  return apiPatch<ProductWriteResponse>(`/api/products/${encodeURIComponent(code)}`, req, {
    headers: idempotencyHeaders(),
  });
}

/**
 * Substituição TOTAL (`PUT /api/products/:code`): todos os campos são
 * enviados e o que vier vazio/`null` ZERA de propósito. 422 se faltar campo.
 */
export function putProduct(
  code: string,
  req: ReplaceProductRequest,
): Promise<ProductWriteResponse> {
  return apiPut<ProductWriteResponse>(`/api/products/${encodeURIComponent(code)}`, req, {
    headers: idempotencyHeaders(),
  });
}

/** Arquivamento exige confirmação explícita na UI (DestructiveForm); responde com `auditId`. */
export function archiveProduct(
  code: string,
  req: ArchiveProductRequest,
): Promise<ProductView & { auditId: string }> {
  return apiPost<ProductView & { auditId: string }>(`/api/products/${encodeURIComponent(code)}/archive`, req, {
    headers: idempotencyHeaders(),
  });
}

/** Emissão de licença p/ customerId + planId (chave NUNCA em plaintext — só `keyMasked`). */
export function issueProductLicense(
  code: string,
  req: IssueProductLicenseRequest,
): Promise<{ licenseId: string; keyMasked: string; auditId: string }> {
  return apiPost(`/api/products/${encodeURIComponent(code)}/issue`, req, {
    headers: idempotencyHeaders(),
  });
}

/** Renovação com substituição (motivo ≥ 10 + confirmação; anterior desativada). */
export function renewReplaceLicense(
  id: string,
  req: RenewReplaceRequest,
): Promise<{ newLicenseId: string; revoked: boolean; auditId: string }> {
  return apiPost(`/api/licenses/${encodeURIComponent(id)}/renew-replace`, req, {
    headers: idempotencyHeaders(),
  });
}

/**
 * Histórico de substituições (array direto do BFF; aceita `Page` p/
 * forward-compat com o backend paginado futuro).
 *
 * `scope: "product"` diz ao BFF que `ref` é um PRODUCT CODE: ele vai direto
 * ao fan-out das licenças do produto em vez de sondar `ref` como licenseId e
 * depender de um 404 do upstream para descobrir que errou (ida-e-volta inútil
 * em toda abertura da aba + log de erro falso).
 */
export function listLicenseHistory(
  ref: string,
  opts: { scope?: "license" | "product"; limit?: number } = {},
): Promise<LicenseHistoryEntry[] | Page<LicenseHistoryEntry>> {
  return apiGet<LicenseHistoryEntry[] | Page<LicenseHistoryEntry>>(
    `/api/licenses/${encodeURIComponent(ref)}/history${toQuery({
      scope: opts.scope === "product" ? "product" : undefined,
      limit: opts.limit !== undefined ? String(opts.limit) : undefined,
    })}`,
  );
}

/**
 * Troca de preço versionada (preço imutável — novo preço = nova linha;
 * propaga p/ recebíveis abertos; contrato fechado nunca muda).
 * Exige motivo ≥ 10 + confirmação explícita (422 no BFF senão).
 */
export function changePlanPrice(
  code: string,
  req: PlanPriceChangeRequest,
): Promise<PlanPriceChangeResult> {
  return apiPost<PlanPriceChangeResult>(
    `/api/products/${encodeURIComponent(code)}/plans/change-price`,
    req,
    { headers: idempotencyHeaders() },
  );
}

/** Clientes com licenças ativas/em graça do produto (agregado por `productId`). */
export function getProductActiveClients(code: string): Promise<ProductActiveClient[]> {
  return apiGet<ProductActiveClient[]>(`/api/products/${encodeURIComponent(code)}/clients`);
}

/**
 * Estado ATUAL das chaves do produto (`GET /v1/products/:code/licenses`).
 *
 * Diferente de `listLicenseHistory`: aqui `status` é o efetivo AGORA, derivado
 * do relógio (`grace`/`expired` já resolvidos). É esta leitura que impede chave
 * vencida de aparecer como "Ativa".
 *
 * O filtro de `status` é enviado ao servidor (o upstream filtra NO SQL), mas a
 * UI também filtra a página no cliente p/ manter a contagem por estado visível
 * sem trocar a página.
 */
export function listProductLicenses(
  code: string,
  opts: { limit?: number; offset?: number; status?: LicenseEffectiveStatus | null } = {},
): Promise<ProductLicensesPage> {
  return apiGet<ProductLicensesPage>(
    `/api/products/${encodeURIComponent(code)}/licenses${toQuery({
      limit: opts.limit !== undefined ? String(opts.limit) : undefined,
      offset: opts.offset !== undefined ? String(opts.offset) : undefined,
      status: opts.status ?? undefined,
    })}`,
  );
}

import type { ProductImage as ProductImageType } from "./types";

/**
 * Galeria persistida na VPS (backend em disco; stub responde 501 honesto).
 * Upload via multipart (`file`); remoção apaga linha + bytes.
 */
export async function uploadProductImage(code: string, file: File): Promise<ProductImageType> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/products/${encodeURIComponent(code)}/images`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    let message = `Falha no upload (${res.status}).`;
    try {
      const body = (await res.json()) as { message?: string };
      if (typeof body.message === "string") message = body.message;
    } catch {
      /* mantém mensagem padrão */
    }
    throw new Error(message);
  }
  return (await res.json()) as ProductImageType;
}

export async function deleteProductImage(code: string, id: string): Promise<void> {
  const res = await fetch(`/api/products/${encodeURIComponent(code)}/images/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    let message = `Falha ao remover (${res.status}).`;
    try {
      const body = (await res.json()) as { message?: string };
      if (typeof body.message === "string") message = body.message;
    } catch {
      /* mantém mensagem padrão */
    }
    throw new Error(message);
  }
}
