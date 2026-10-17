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
 * O slug é ESTÁVEL e vai para o banco (`products.Product.platforms`): é o mesmo
 * id do catálogo de ícones (`tools/build-tag-icons.py`). Renomear um id aqui
 * exige migration de dado — nunca renomeie por vaidade.
 *
 * Este é o único lugar onde o catálogo deveria viver; `apps/api` mantém uma
 * cópia defensiva em `modules/products/dto.ts` porque ainda NÃO consome este
 * pacote (ver o TODO lá). Quando o workspace passar a linkingar
 * `@aurum-bit/contracts`, apague a cópia da API.
 */
export const PLATFORM_IDS = ["windows", "macos", "linux", "web", "apple"] as const;
export const PLATFORM_ID_SCHEMA = z.enum(PLATFORM_IDS);
export type PlatformId = z.infer<typeof PLATFORM_ID_SCHEMA>;

/** Rótulos pt-BR para UI (admin/portal). Ícone correspondente: `PlatformIcon`. */
export const PLATFORM_LABELS: Record<PlatformId, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  web: "Web",
  apple: "Apple (iOS/iPadOS)",
};

/**
 * Como o produto é entregue: `OFFLINE` (só no dispositivo, sem rede) ou
 * `HYBRID` (opera offline e sincroniza com o servidor). Default `OFFLINE`.
 */
export const DELIVERY_MODES = ["OFFLINE", "HYBRID"] as const;
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
