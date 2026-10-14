/**
 * Contratos zod — auth (Fase 2).
 * Espelham os DTOs class-validator de `apps/api/src/modules/auth/dto.ts`
 * (limites idênticos); estes schemas são o contrato HTTP v1 público
 * (admin Next, integrações), os DTOs do módulo são a validação interna.
 */
import { z } from "zod";

const email = z.string().email().max(254);
const password = z.string().min(8).max(128);
const token256 = z.string().min(1).max(256);
const deviceLabel = z.string().max(128).optional();

/** Consentimento no registro (TERMS+PRIVACY obrigatórios — min 2). */
export const ConsentSchema = z.object({
  type: z.enum(["TERMS", "PRIVACY"]),
  version: z.string().min(1).max(64),
});
export type Consent = z.infer<typeof ConsentSchema>;

export const RegisterSchema = z.object({
  email,
  password,
  consents: z.array(ConsentSchema).min(2),
  deviceLabel,
});
export type RegisterRequest = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  deviceLabel,
});
export type LoginRequest = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: token256.optional(),
  /** Quando true, o refresh rotacionado também é gravado em cookie httpOnly. */
  setCookie: z.boolean().optional(),
});
export type RefreshRequest = z.infer<typeof RefreshSchema>;

export const ForgotSchema = z.object({ email });
export type ForgotRequest = z.infer<typeof ForgotSchema>;

export const ResetSchema = z.object({
  token: token256,
  newPassword: password,
});
export type ResetRequest = z.infer<typeof ResetSchema>;

export const VerifyEmailSchema = z.object({ token: token256 });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailSchema>;

export const ResendVerificationSchema = z.object({ email });
export type ResendVerificationRequest = z.infer<typeof ResendVerificationSchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordSchema>;

export const MfaVerifySchema = z.object({
  code: z.string().min(1).optional(),
  /** Fluxo login step-up (sem Authorization): ticket retornado pelo login. */
  ticket: z.string().min(1).optional(),
  deviceLabel,
});
export type MfaVerifyRequest = z.infer<typeof MfaVerifySchema>;

/** Par de tokens emitido por login/refresh (refresh rotativo, reuse revoga família). */
export const AuthTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** Segundos até expirar o access (default 900 = 15min). */
  expiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

/**
 * Claims do access JWT (contrato da cadeia `common/guards` —
 * ver `apps/api/src/common/auth/jwt-payload.ts`).
 */
export const JwtClaimsSchema = z.object({
  sub: z.string().min(1),
  sid: z.string().min(1),
  jti: z.string().min(1),
  iss: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  iat: z.number().int(),
  exp: z.number().int(),
  nbf: z.number().int().optional(),
  amr: z.array(z.string()).optional(),
  email_verified: z.boolean().optional(),
  roles: z.array(z.string()).optional(),
  token_version: z.number().int().optional(),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;
