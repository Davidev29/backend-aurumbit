/**
 * Contratos zod — products (Fase 2): catálogo imutável.
 * Regra: preço nunca sofre update — novo preço = nova linha de plano
 * (espelha `CreatePlanDto`: `IMUTÁVEL`).
 */
import { z } from "zod";

export const BillingIntervalSchema = z.enum(["MONTH", "YEAR", "ONE_TIME"]);
export type BillingInterval = z.infer<typeof BillingIntervalSchema>;

/**
 * Catálogo canônico de plataformas do produto.
 *
 * FONTE ÚNICA: `libs/contracts/src/products.catalog.json` (dado — o mesmo que
 * o `tools/build-tag-icons.py` lê para gerar os PNGs). Este arquivo NÃO lista
 * ids/labels à mão: ele reexporta o artefato gerado por
 * `tools/sync-platform-catalog.mjs` (`pnpm catalog:sync`), e o CI reprova
 * drift com `pnpm catalog:check` (inclusive ícone órfão em `public/tags`).
 *
 * O slug é ESTÁVEL e vai para o banco (`products.Product.platforms`): renomear
 * um id exige migration de dado — nunca renomeie por vaidade.
 *
 * As cópias defensivas dos apps (`apps/api/modules/products/dto.ts`,
 * `apps/{admin,portal}/lib/platforms.ts`) também são geradas da MESMA fonte —
 * não existe mais "manter os dois iguais à mão".
 */
import {
  CATALOG_DELIVERY_MODES,
  CATALOG_PLATFORM_IDS,
  CATALOG_PLATFORM_LABELS,
  CATALOG_PLATFORM_SHORT_LABELS,
} from "./products.catalog.generated";

export const PLATFORM_IDS = CATALOG_PLATFORM_IDS;
export const PLATFORM_ID_SCHEMA = z.enum(PLATFORM_IDS);
export type PlatformId = z.infer<typeof PLATFORM_ID_SCHEMA>;

/** Rótulos pt-BR para UI (admin/portal). Ícone correspondente: `PlatformIcon`. */
export const PLATFORM_LABELS: Record<PlatformId, string> = CATALOG_PLATFORM_LABELS;

/** Versão curta (cards estreitos, onde o rótulo completo não cabe). */
export const PLATFORM_SHORT_LABELS: Record<PlatformId, string> = CATALOG_PLATFORM_SHORT_LABELS;

/**
 * Como o produto é entregue: `OFFLINE` (só no dispositivo, sem rede) ou
 * `HYBRID` (opera offline e sincroniza com o servidor). Default `OFFLINE`.
 */
export const DELIVERY_MODES = CATALOG_DELIVERY_MODES;
export const DELIVERY_MODE_SCHEMA = z.enum(DELIVERY_MODES);
export type DeliveryMode = z.infer<typeof DELIVERY_MODE_SCHEMA>;

/**
 * `GET /v1/products` / `GET /v1/products/:code`.
 * Espelha a linha real do banco (`ProductDetail` em apps/api). `status` inclui
 * ARCHIVED porque `GET /v1/products/:code` o devolve para produto arquivado;
 * a lista pública (`GET /v1/products`) só traz ACTIVE.
 * `platforms: []` = nenhuma plataforma declarada (NÃO é "todas").
 */
export const ProductResponseSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(2).max(64),
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(120),
  description: z.string().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  machinesAllowed: z.number().int().min(1),
  platforms: z.array(PLATFORM_ID_SCHEMA),
  deliveryMode: DELIVERY_MODE_SCHEMA,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProductResponse = z.infer<typeof ProductResponseSchema>;

/** Plano de catálogo (linha imutável; `priceCents` congelado na contratação). */
export const PlanSchema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  code: z.string().min(2).max(64),
  name: z.string().min(2).max(120),
  interval: BillingIntervalSchema,
  priceCents: z.number().int().min(0),
  validFrom: z.string().datetime(),
  validTo: z.string().datetime().optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const CreatePlanSchema = z.object({
  productCode: z.string().min(1),
  code: z.string().min(2).max(64),
  name: z.string().min(2).max(120),
  priceCents: z.number().int().min(0),
  billingInterval: BillingIntervalSchema,
  validFrom: z.string().datetime(),
  validTo: z.string().datetime().optional(),
  features: z
    .array(z.object({ featureCode: z.string().min(1), value: z.string().max(64).optional() }))
    .min(1)
    .optional(),
});
export type CreatePlanRequest = z.infer<typeof CreatePlanSchema>;
