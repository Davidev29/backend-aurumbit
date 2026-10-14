export const IDENTITY_STATUS = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  LOCKED: 'LOCKED',
  DELETED: 'DELETED',
} as const;
export type IdentityStatus = (typeof IDENTITY_STATUS)[keyof typeof IDENTITY_STATUS];

export const SESSION_STATUS = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;

export const REFRESH_STATUS = {
  ACTIVE: 'ACTIVE',
  ROTATED: 'ROTATED',
  REVOKED: 'REVOKED',
  REUSED: 'REUSED',
  EXPIRED: 'EXPIRED',
} as const;

// Eventos de outbox emitidos pela Fase 2 (sem Asaas/Resend real).
// PasswordResetRequested existe porque o fluxo forgot (60min hash-only) exige o
// template `reset-password` (PROJECT §6); sem ele o forgot seria um beco sem saída.
export const OUTBOX_TYPES = {
  IdentityCreated: 'auth.identity.created.v1',
  EmailVerified: 'auth.email.verified.v1',
  PasswordChanged: 'auth.password.changed.v1',
  SessionRevoked: 'auth.session.revoked.v1',
  PasswordResetRequested: 'auth.password.reset_requested.v1',
  // Fase 6 (LGPD): anonimização do titular. Payload só com identityId opaco (sem PII).
  IdentityAnonymized: 'auth.identity.anonymized.v1',
} as const;

/** Erro de domínio: a controller mapeia code→HTTP sem vazar PII. */
export class AuthError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSec?: number;
  constructor(code: string, status: number, message?: string, retryAfterSec?: number) {
    super(message ?? code);
    this.code = code;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export interface ConsentInput {
  type: string;
  version: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  mfaRequired?: undefined;
}

export interface LoginMfaChallenge {
  mfaRequired: true;
  mfaTicket: string;
  expiresIn: number;
}
