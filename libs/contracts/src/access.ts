/**
 * Contratos zod — access (Fase 2): resposta do check-access.
 * Decisão calculada por `evaluateCheck` (`apps/api/.../access-policy.ts`,
 * semântica PROJECT §1): `allow` + `degraded` (graça de 3d) ou `deny`
 * com `reason`/`errorCode` estáveis (`EXPIRED`, `DEVICE_LIMIT` —
 * limite de máquinas, REQUIREMENTS §2 — e demais `ERROR_CODES`).
 */
import { z } from "zod";

export const CheckAccessReasonSchema = z.enum([
  "ACTIVE",
  "LIFETIME",
  "GRACE",
  "NOT_FOUND",
  "REVOKED",
  "SUSPENDED",
  "EXPIRED",
  "DEVICE_LIMIT",
]);
export type CheckAccessReason = z.infer<typeof CheckAccessReasonSchema>;

export const CheckAccessQuerySchema = z.object({
  ownerType: z.enum(["CUSTOMER", "ORGANIZATION"]),
  ownerId: z.string().min(1).max(128),
  productId: z.string().min(1).max(128),
  featureCode: z.string().min(1).max(64),
});
export type CheckAccessQuery = z.infer<typeof CheckAccessQuerySchema>;

export const CheckAccessBatchSchema = z.object({
  checks: z.array(CheckAccessQuerySchema).min(1).max(50),
});
export type CheckAccessBatch = z.infer<typeof CheckAccessBatchSchema>;

/**
 * Resposta do check-access: `degraded:true` ⇔ dentro da graça
 * (banner, sem ações destrutivas — PROJECT §1). `errorCode` presente
 * apenas quando `allow:false`.
 */
export const CheckAccessResponseSchema = z.object({
  allow: z.boolean(),
  degraded: z.boolean(),
  reason: CheckAccessReasonSchema,
  entitlementId: z.string().min(1).optional(),
  origin: z.enum(["BONUS", "CONTRACT", "SUBSCRIPTION", "LICENSE"]).optional(),
  priority: z.number().int().optional(),
  quotaValue: z.string().nullable().optional(),
  errorCode: z.string().optional(),
});
export type CheckAccessResponse = z.infer<typeof CheckAccessResponseSchema>;
