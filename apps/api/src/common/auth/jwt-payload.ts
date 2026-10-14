/**
 * Payload JWT Fase 2 (contrato interno dos guards compartilhados).
 *
 * Claims obrigatórias: `sub` (identityId), `sid` (session id), `jti`
 * (id único do token), `iss`, `aud`, `iat`, `exp`.
 * Claims condicionais: `amr` (métodos de autenticação; contém `mfa`
 * quando step-up concluído), `email_verified`, `roles` (convenção
 * `STAFF_*` p/ staff; membership de org via `customer-scope.guard`),
 * `token_version` (bump em revogação — Fase 3 compara com licença).
 *
 * NOTA DE COEXISTÊNCIA (Fase 2, monólito em construção paralela):
 * `modules/auth` possui guards próprios wired a `AuthService`/Prisma
 * (`verifyAccess` com claims `identityId/sessionId/familyId/mfa`).
 * Este contrato é o da cadeia compartilhada `common/guards`
 * (ver `docs/ADR-002-guards.md`); a convergência ocorre na Fase 3.
 */
export interface JwtPayload {
  /** auth.UserIdentity.id (referência opaca cross-DB). */
  sub: string;
  /** AuthSession id — checado pelo `session.guard` (ACTIVE). */
  sid: string;
  /** Id único do token (rastreio/revogação). */
  jti: string;
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
  nbf?: number;
  /** Authentication Methods References ex.: `["pwd"]`, `["pwd","mfa"]`. */
  amr?: string[];
  email_verified?: boolean;
  /** Convenção staff: `STAFF_ADMIN`, `STAFF_SUPPORT`, ... (ver `roles.guard`). */
  roles?: string[];
  /** Bump em revogação de licença/sessão (Fase 3). */
  token_version?: number;
}

/**
 * Principal que os guards anexam a `request.user`.
 * Sem PII além do necessário (sem e-mail/senha/token — LGPD.md §3).
 */
export interface AuthPrincipal {
  identityId: string;
  sessionId: string;
  tokenId: string;
  issuer: string;
  audience: string[];
  issuedAt: number;
  expiresAt: number;
  amr: string[];
  emailVerified: boolean;
  roles: string[];
  tokenVersion: number;
}

export function toPrincipal(p: JwtPayload): AuthPrincipal {
  return {
    identityId: p.sub,
    sessionId: p.sid,
    tokenId: p.jti,
    issuer: p.iss,
    audience: Array.isArray(p.aud) ? p.aud : [p.aud],
    issuedAt: p.iat,
    expiresAt: p.exp,
    amr: p.amr ?? [],
    emailVerified: p.email_verified ?? false,
    roles: p.roles ?? [],
    tokenVersion: p.token_version ?? 0,
  };
}

/** Convenção de roles staff (PROJECT §3: `finance.read` é concessão explícita). */
export const STAFF_ROLES = ['STAFF_ADMIN', 'STAFF_SUPPORT', 'STAFF_FINANCE'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
