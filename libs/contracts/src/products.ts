/**
 * Contratos zod — products (Fase 2): catálogo imutável.
 * Regra: preço nunca sofre update — novo preço = nova linha de plano
 * (espelha `CreatePlanDto`: `IMUTÁVEL`).
 */
import { z } from "zod";

export const BillingIntervalSchema = z.enum(["MONTH", "YEAR", "ONE_TIME"]);
export type BillingInterval = z.infer<typeof BillingIntervalSchema>;

export const ProductResponseSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(2).max(64),
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(120),
  status: z.enum(["DRAFT", "ACTIVE"]),
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
