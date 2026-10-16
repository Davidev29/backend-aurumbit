/**
 * Contrato de ativação — conta (Modo A) ou chave (Modo B).
 * Fonte normativa: docs/ACTIVATION.md + portal/lib/api.ts (ActivationResult).
 * Aditivo forward-compatible: produtores SÓ adicionam opcionais.
 */
import { z } from "zod";

export const ActivationModeSchema = z.enum(["account", "key"]);
export type ActivationMode = z.infer<typeof ActivationModeSchema>;

export const ActivationRequestSchema = z.object({
  productId: z.string().min(1).max(128).optional(),
  app_instance_id: z.string().min(1).max(128).optional(),
  label: z.string().max(120).optional(),
  key: z.string().regex(/^AURUM-[A-Z0-9-]+$/i).optional(),
});
export type ActivationRequest = z.infer<typeof ActivationRequestSchema>;

/**
 * Resposta única dos dois modos:
 * - Modo A: POST /api/me/licenses/activate (BFF portal, cookies httpOnly)
 * - Modo B: POST /v1/licenses/activate-by-key (Nest direto, @Public + licenseReveal)
 * device_hash = HMAC(server-side, license||instance) hex64 — nunca derivado no cliente.
 * off_exp = min(iat+7d, expires_at+7d). token_version bump invalida offline-tokens.
 */
export const ActivationResultSchema = z.object({
  mode: ActivationModeSchema,
  stub: z.boolean().optional(),
  licenseId: z.string().min(1),
  keyMasked: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  planId: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  graceUntil: z.string().nullable().optional(),
  device_hash: z.string().min(1),
  deviceCreated: z.boolean().optional(),
  offlineToken: z.string().min(1),
  off_exp: z.string().nullable().optional(),
  token_version: z.number().int().optional(),
});
export type ActivationResult = z.infer<typeof ActivationResultSchema>;

/** Erros estáveis de ativação (nunca fundir OFFLINE_EXPIRED com EXPIRED). */
export const ACTIVATION_ERROR_CODES = [
  "UNAUTHORIZED",
  "REVOKED",
  "ACCOUNT_NO_LICENSE",
  "KEY_INVALID",
  "LICENSE_INACTIVE",
  "DEVICE_LIMIT",
  "DEVICE_CONFLICT",
  "DEVICE_BLOCKED",
  "UPSTREAM_UNAVAILABLE",
] as const;
export type ActivationErrorCode = (typeof ACTIVATION_ERROR_CODES)[number];

/**
 * Lote demo/promo sem conta — POST /v1/licenses/trial-issue (admin).
 * expiresInHours 1..8760 (horas/dias) ou infinite=true (parceria lifetime).
 * Ativação sempre por chave: POST /v1/licenses/activate-by-key.
 */
export const TrialIssueRequestSchema = z.object({
  productId: z.string().min(1).max(128),
  planId: z.string().min(1).max(128).optional(),
  qty: z.number().int().min(1).max(100).optional(),
  maxDevices: z.number().int().min(1).max(100).optional(),
  expiresInHours: z.number().int().min(1).max(8760).optional(),
  infinite: z.boolean().optional(),
  ownerLabel: z.string().min(1).max(120).optional(),
  note: z.string().min(1).max(120).optional(),
  startsAt: z.string().optional(),
});
export type TrialIssueRequest = z.infer<typeof TrialIssueRequestSchema>;

export const TrialIssueResultSchema = z.object({
  batchId: z.string().min(1),
  kind: z.enum(["trial", "lifetime"]),
  expiresAt: z.string().nullable(),
  items: z.array(
    z.object({
      licenseId: z.string().min(1),
      key: z.string().min(1),
      keyMasked: z.string(),
      expiresAt: z.string().nullable(),
    }),
  ),
});
export type TrialIssueResult = z.infer<typeof TrialIssueResultSchema>;
