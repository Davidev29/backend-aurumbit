import { Injectable } from '@nestjs/common';
import { IAuthRepository } from './auth.repository';
import { AuthError, ConsentInput, IDENTITY_STATUS, LoginMfaChallenge, LoginResult, OUTBOX_TYPES } from './auth.types';
import { emitSecurityEvent, getSecurityEventPool } from '../audit/security-events';
import {
  decryptSecret,
  deriveEncKey,
  encryptSecret,
  hashPassword,
  maskEmail,
  mfaOtpauthUrl,
  newId,
  newMfaSecret,
  normalizeEmail,
  randomTokenHex,
  sha256Hex,
  signAccessToken,
  signMfaTicket,
  validatePasswordPolicy,
  verifyAccessToken,
  verifyMfaTicket,
  verifyPassword,
  verifyTotp,
} from './crypto';

export interface AuthOptions {
  jwtSecret: string;
  jwtIssuer?: string;
  jwtAudience?: string;
  accessTtlSec?: number;
  clock?: () => Date;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;
const VERIFY_TTL_MS = 24 * 3600_000;
const RECOVERY_TTL_MS = 60 * 60_000; // 60min
const SESSION_TTL_MS = 30 * 24 * 3600_000;
const REFRESH_TTL_MS = 30 * 24 * 3600_000;

/** Resposta genérica anti-enumeração (mesmo shape p/ existente/inexistente). */
export const GENERIC_OK = { ok: true } as const;

function isEmail(s: string): boolean {
  return /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/.test(s);
}

@Injectable()
export class AuthService {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly accessTtlSec: number;

  constructor(
    private readonly repo: IAuthRepository,
    private readonly opts: AuthOptions,
  ) {
    this.issuer = opts.jwtIssuer ?? process.env.JWT_ISS ?? 'aurum-bit';
    this.audience = opts.jwtAudience ?? process.env.JWT_AUD ?? 'aurum-clients';
    this.accessTtlSec = opts.accessTtlSec ?? 900; // 15min
  }

  private now(): Date {
    return this.opts.clock ? this.opts.clock() : new Date();
  }

  private get secret(): string {
    const s = this.opts.jwtSecret ?? process.env.AUTH_JWT_SECRET ?? process.env.JWT_SECRET;
    if (!s) throw new AuthError('CONFIG_MISSING', 500, 'JWT_SECRET ausente');
    return s;
  }

  private encKey(): Buffer {
    // TODO(KMS): envelope encryption; hoje deriva de env com fallback dev-only.
    const k = process.env.MFA_ENC_KEY ?? this.secret;
    return deriveEncKey('aurum-mfa-v1', k);
  }

  // ---------------------------------------------------------------- register
  async register(input: { email: string; password: string; consents: ConsentInput[]; deviceLabel?: string }): Promise<{ ok: true }> {
    const { norm, display } = normalizeEmail(input.email ?? '');
    if (!isEmail(norm)) throw new AuthError('INVALID_EMAIL', 400);
    const policy = validatePasswordPolicy(input.password, norm);
    if (policy.length > 0) throw new AuthError(policy[0], 400);
    const consents = Array.isArray(input.consents) ? input.consents : [];
    const hasTerms = consents.some((c) => String(c.type).toUpperCase() === 'TERMS' && String(c.version).length > 0);
    const hasPrivacy = consents.some((c) => String(c.type).toUpperCase() === 'PRIVACY' && String(c.version).length > 0);
    if (!hasTerms || !hasPrivacy) throw new AuthError('CONSENTS_REQUIRED', 400, 'Consents TERMS+PRIVACY versionados são obrigatórios.');

    // Anti-enumeração: duplicado retorna o mesmo shape, sem criar nada novo.
    const existing = await this.repo.findIdentityByEmailNorm(norm);
    if (existing) return { ...GENERIC_OK };

    const identity = await this.repo.createIdentity({ emailNorm: norm, emailDisplay: display, status: IDENTITY_STATUS.PENDING_VERIFICATION });
    await this.repo.createCredential({ identityId: identity.id, passwordHash: await hashPassword(input.password) });
    for (const c of consents) {
      const type = String(c.type).toUpperCase();
      if (type === 'TERMS' || type === 'PRIVACY') {
        await this.repo.createConsent({ identityId: identity.id, type, version: String(c.version) });
      }
    }
    // Token opaco: raw só no outbox (template verify-email); DB guarda hash-only.
    const raw = randomTokenHex(32);
    await this.repo.createVerificationToken({ identityId: identity.id, tokenHash: sha256Hex(raw), expiresAt: new Date(+this.now() + VERIFY_TTL_MS) });
    await this.repo.emitOutbox({
      eventId: newId(),
      aggregate: 'user_identity',
      aggregateId: identity.id,
      type: OUTBOX_TYPES.IdentityCreated,
      payload: { identityId: identity.id, emailMasked: maskEmail(display), verificationToken: raw, template: 'verify-email', templateVersion: 'v1' },
    });
    return { ...GENERIC_OK };
  }

  // ---------------------------------------------------------- verify / resend
  async verifyEmail(rawToken: string): Promise<{ ok: true }> {
    const rec = await this.repo.findVerificationTokenByHash(sha256Hex(String(rawToken ?? '')));
    if (!rec || rec.consumedAt || +rec.expiresAt <= +this.now()) return { ...GENERIC_OK }; // genérico
    const identity = await this.repo.findIdentityById(rec.identityId);
    if (!identity) return { ...GENERIC_OK };
    await this.repo.consumeVerificationToken(rec.id);
    if (identity.status === IDENTITY_STATUS.PENDING_VERIFICATION) {
      await this.repo.updateIdentity(identity.id, { status: IDENTITY_STATUS.ACTIVE, emailVerifiedAt: this.now(), failedAttempts: 0, lockedUntil: null });
    }
    await this.repo.emitOutbox({ eventId: newId(), aggregate: 'user_identity', aggregateId: identity.id, type: OUTBOX_TYPES.EmailVerified, payload: { identityId: identity.id } });
    return { ...GENERIC_OK };
  }

  async resendVerification(email: string): Promise<{ ok: true }> {
    const { norm } = normalizeEmail(email ?? '');
    const identity = isEmail(norm) ? await this.repo.findIdentityByEmailNorm(norm) : null;
    if (identity && identity.status === IDENTITY_STATUS.PENDING_VERIFICATION) {
      const raw = randomTokenHex(32);
      await this.repo.createVerificationToken({ identityId: identity.id, tokenHash: sha256Hex(raw), expiresAt: new Date(+this.now() + VERIFY_TTL_MS) });
      await this.repo.emitOutbox({
        eventId: newId(),
        aggregate: 'user_identity',
        aggregateId: identity.id,
        type: OUTBOX_TYPES.IdentityCreated,
        payload: { identityId: identity.id, emailMasked: maskEmail(identity.emailDisplay), verificationToken: raw, template: 'verify-email', templateVersion: 'v1', resend: true },
      });
    }
    return { ...GENERIC_OK }; // sempre genérico
  }

  // ------------------------------------------------------------------- login
  private async checkLock(identity: { status: string; lockedUntil: Date | null }): Promise<void> {
    if (identity.status === IDENTITY_STATUS.LOCKED && identity.lockedUntil && +identity.lockedUntil > +this.now()) {
      const retry = Math.ceil((+identity.lockedUntil - +this.now()) / 1000);
      throw new AuthError('ACCOUNT_LOCKED', 423, 'Conta temporariamente bloqueada.', retry);
    }
  }

  private async failAttempt(identityId: string, attempts: number): Promise<void> {
    const next = attempts + 1;
    if (next >= MAX_FAILED_ATTEMPTS) {
      await this.repo.updateIdentity(identityId, { failedAttempts: next, status: IDENTITY_STATUS.LOCKED, lockedUntil: new Date(+this.now() + LOCKOUT_MS) });
    } else {
      await this.repo.updateIdentity(identityId, { failedAttempts: next });
    }
  }

  private async issueSession(identityId: string, deviceLabel: string | null, mfa: boolean): Promise<LoginResult> {
    const familyId = newId();
    const session = await this.repo.createSession({ identityId, familyId, deviceLabel, expiresAt: new Date(+this.now() + SESSION_TTL_MS) });
    const rawRefresh = randomTokenHex(32);
    await this.repo.createRefreshToken({ sessionId: session.id, familyId, tokenHash: sha256Hex(rawRefresh), parentHash: null, expiresAt: new Date(+this.now() + REFRESH_TTL_MS) });
    return {
      // Emissão implica identidade verificada (login barra EMAIL_NOT_VERIFIED
      // antes daqui) — expõe p/ a cadeia global `VerifiedEmailGuard`.
      accessToken: signAccessToken({ sub: identityId, sid: session.id, fid: familyId, mfa, email_verified: true }, this.secret, { issuer: this.issuer, audience: this.audience, ttlSec: this.accessTtlSec }),
      refreshToken: rawRefresh,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSec,
    };
  }

  async login(input: { email: string; password: string; deviceLabel?: string }): Promise<LoginResult | LoginMfaChallenge> {
    const { norm } = normalizeEmail(input.email ?? '');
    let identity = await this.repo.findIdentityByEmailNorm(norm);
    // Anti-enumeração: inexistente/DELETED cai no mesmo 401 genérico (com delay dummy).
    if (!identity || identity.status === IDENTITY_STATUS.DELETED) {
      await verifyPassword('$scrypt$16384$8$1$ZHVtbXk=$ZHVtbXk=', 'dummy').catch(() => false);
      throw new AuthError('INVALID_CREDENTIALS', 401, 'Credenciais inválidas.');
    }
    await this.checkLock(identity);
    // Lock expirado: checkLock não lançou → reabre automaticamente.
    if (identity.status === IDENTITY_STATUS.LOCKED) {
      identity = await this.repo.updateIdentity(identity.id, { status: IDENTITY_STATUS.ACTIVE, failedAttempts: 0, lockedUntil: null });
    }
    const cred = await this.repo.findCredentialByIdentityId(identity.id);
    const ok = cred ? await verifyPassword(cred.passwordHash, input.password).catch(() => false) : false;
    if (!ok) {
      await this.failAttempt(identity.id, identity.failedAttempts);
      // E7 (Fase 9): trilha de segurança best-effort (fire-and-forget —
      // nunca muda a decisão/anti-enumeração do login).
      void emitSecurityEvent(getSecurityEventPool(), {
        type: 'LOGIN_FAILED',
        actorId: identity.id,
        entity: 'user_identity',
        entityId: identity.id,
        metadata: {
          reason:
            identity.failedAttempts + 1 >= MAX_FAILED_ATTEMPTS
              ? 'ACCOUNT_LOCKED'
              : 'INVALID_CREDENTIALS',
        },
      });
      throw new AuthError('INVALID_CREDENTIALS', 401, 'Credenciais inválidas.');
    }
    await this.repo.updateIdentity(identity.id, { failedAttempts: 0, lockedUntil: null });
    if (identity.status === IDENTITY_STATUS.PENDING_VERIFICATION) {
      throw new AuthError('EMAIL_NOT_VERIFIED', 403, 'E-mail ainda não verificado.');
    }
    const fresh = await this.repo.findIdentityById(identity.id);
    if (!fresh || fresh.status === IDENTITY_STATUS.DELETED) throw new AuthError('INVALID_CREDENTIALS', 401, 'Credenciais inválidas.');
    if (fresh.mfaEnabled) {
      return { mfaRequired: true as const, mfaTicket: signMfaTicket(fresh.id, this.secret, { issuer: this.issuer, audience: this.audience }), expiresIn: 300 };
    }
    return this.issueSession(fresh.id, input.deviceLabel ?? null, false);
  }

  // ------------------------------------------------------------------ refresh
  private async revokeFamily(familyId: string, reason: string, aggregateId: string): Promise<void> {
    await this.repo.revokeFamilySessions(familyId, reason);
    await this.repo.revokeFamilyTokens(familyId, 'REVOKED');
    await this.repo.emitOutbox({ eventId: newId(), aggregate: 'auth_session_family', aggregateId, type: OUTBOX_TYPES.SessionRevoked, payload: { familyId, reason } });
  }

  async refresh(rawToken: string): Promise<LoginResult> {
    const hash = sha256Hex(String(rawToken ?? ''));
    const rec = await this.repo.findRefreshTokenByHash(hash);
    if (!rec) throw new AuthError('INVALID_TOKEN', 401, 'Sessão inválida.');
    const session = await this.repo.findSessionById(rec.sessionId);

    // Reuso: token já rotacionado/revogado ou sessão revogada por reuso → revoga a família.
    if (rec.status === 'ROTATED' || rec.status === 'REVOKED' || rec.status === 'REUSED') {
      await this.repo.updateRefreshToken(rec.id, { status: 'REUSED' }).catch(() => undefined);
      await this.revokeFamily(rec.familyId, 'REUSE_DETECTED', rec.familyId);
      // E7 (Fase 9): reuso detectado — trilha best-effort (decisão inalterada).
      void emitSecurityEvent(getSecurityEventPool(), {
        type: 'TOKEN_ROTATED',
        actorId: session?.identityId,
        entity: 'auth_session_family',
        entityId: rec.familyId,
        metadata: { reason: 'REUSE_DETECTED', familyId: rec.familyId },
      });
      throw new AuthError('REUSE_DETECTED', 401, 'Sessão inválida.');
    }
    if (!session || session.status !== 'ACTIVE') {
      if (session && session.revokedReason === 'REUSE_DETECTED') {
        throw new AuthError('REUSE_DETECTED', 401, 'Sessão inválida.');
      }
      throw new AuthError('INVALID_TOKEN', 401, 'Sessão inválida.');
    }
    if (+rec.expiresAt <= +this.now() || +session.expiresAt <= +this.now()) {
      await this.repo.updateRefreshToken(rec.id, { status: 'EXPIRED' }).catch(() => undefined);
      await this.repo.updateSession(session.id, { status: 'EXPIRED' }).catch(() => undefined);
      throw new AuthError('TOKEN_EXPIRED', 401, 'Sessão expirada.');
    }
    const identity = await this.repo.findIdentityById(session.identityId);
    if (!identity || identity.status === IDENTITY_STATUS.DELETED || identity.status === IDENTITY_STATUS.LOCKED) {
      throw new AuthError('INVALID_TOKEN', 401, 'Sessão inválida.');
    }
    // Rotação: invalida o atual, emite o próximo na mesma família/sessão.
    await this.repo.updateRefreshToken(rec.id, { status: 'ROTATED', rotatedAt: this.now() });
    // E7 (Fase 9): rotação legítima — trilha best-effort (decisão inalterada).
    void emitSecurityEvent(getSecurityEventPool(), {
      type: 'TOKEN_ROTATED',
      actorId: session.identityId,
      entity: 'auth_session_family',
      entityId: rec.familyId,
      metadata: { reason: 'ROTATED', familyId: rec.familyId },
    });
    const nextRaw = randomTokenHex(32);
    await this.repo.createRefreshToken({ sessionId: session.id, familyId: rec.familyId, tokenHash: sha256Hex(nextRaw), parentHash: hash, expiresAt: new Date(+this.now() + REFRESH_TTL_MS) });
    await this.repo.updateSession(session.id, { lastSeenAt: this.now() });
    return {
      // Continuidade de sessão verificada (login barrou não-verificados).
      accessToken: signAccessToken({ sub: session.identityId, sid: session.id, fid: rec.familyId, mfa: identity.mfaEnabled, email_verified: true }, this.secret, { issuer: this.issuer, audience: this.audience, ttlSec: this.accessTtlSec }),
      refreshToken: nextRaw,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSec,
    };
  }

  // ------------------------------------------------------------------ logout
  async logout(identityId: string, sessionId: string): Promise<{ ok: true }> {
    const s = await this.repo.findSessionById(sessionId);
    if (s && s.identityId === identityId && s.status === 'ACTIVE') {
      await this.repo.updateSession(s.id, { status: 'REVOKED', revokedReason: 'USER_LOGOUT' });
      await this.repo.revokeFamilyTokens(s.familyId, 'REVOKED').catch(() => 0);
      // Revoga só os tokens desta sessão (família pode ter 1 sessão; simplifica p/ família).
      await this.repo.emitOutbox({ eventId: newId(), aggregate: 'auth_session', aggregateId: s.id, type: OUTBOX_TYPES.SessionRevoked, payload: { sessionId: s.id, reason: 'USER_LOGOUT' } });
    }
    return { ...GENERIC_OK };
  }

  // ---------------------------------------------------------------- sessions
  async listSessions(identityId: string): Promise<Array<{ id: string; deviceLabel: string | null; status: string; expiresAt: Date; lastSeenAt: Date }>> {
    const all = await this.repo.listSessionsByIdentity(identityId);
    return all.map((s) => ({ id: s.id, deviceLabel: s.deviceLabel, status: s.status, expiresAt: s.expiresAt, lastSeenAt: s.lastSeenAt }));
  }

  async revokeSession(identityId: string, sessionId: string): Promise<{ ok: true }> {
    const s = await this.repo.findSessionById(sessionId);
    if (!s || s.identityId !== identityId) throw new AuthError('SESSION_NOT_FOUND', 404);
    if (s.status === 'ACTIVE') {
      await this.repo.updateSession(s.id, { status: 'REVOKED', revokedReason: 'SESSION_REVOKE' });
      await this.repo.emitOutbox({ eventId: newId(), aggregate: 'auth_session', aggregateId: s.id, type: OUTBOX_TYPES.SessionRevoked, payload: { sessionId: s.id, reason: 'SESSION_REVOKE' } });
    }
    return { ...GENERIC_OK };
  }

  // ------------------------------------------------------------ forgot/reset
  async forgotPassword(email: string): Promise<{ ok: true }> {
    const { norm } = normalizeEmail(email ?? '');
    const identity = isEmail(norm) ? await this.repo.findIdentityByEmailNorm(norm) : null;
    if (identity && identity.status !== IDENTITY_STATUS.DELETED) {
      // Single-use: novo pedido invalida o anterior (sobrescreve hash + expiração).
      const raw = randomTokenHex(32);
      await this.repo.updateCredential(identity.id, { recoveryHash: sha256Hex(raw), recoveryExpiresAt: new Date(+this.now() + RECOVERY_TTL_MS), recoveryUsedAt: null }).catch(async () => {
        await this.repo.createCredential({ identityId: identity.id, passwordHash: '' }).catch(() => undefined);
      });
      await this.repo.emitOutbox({
        eventId: newId(),
        aggregate: 'user_identity',
        aggregateId: identity.id,
        type: OUTBOX_TYPES.PasswordResetRequested,
        payload: { identityId: identity.id, emailMasked: maskEmail(identity.emailDisplay), recoveryToken: raw, template: 'reset-password', templateVersion: 'v1', ttlMin: 60 },
      });
    }
    return { ...GENERIC_OK }; // sempre genérico
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<{ ok: true }> {
    const policy = validatePasswordPolicy(newPassword);
    if (policy.length > 0) throw new AuthError(policy[0], 400);
    const cred = await this.repo.findCredentialByRecoveryHash(sha256Hex(String(rawToken ?? '')));
    if (!cred || !cred.recoveryExpiresAt || cred.recoveryUsedAt || +cred.recoveryExpiresAt <= +this.now()) {
      throw new AuthError('INVALID_TOKEN', 400, 'Token inválido ou expirado.');
    }
    await this.repo.updateCredential(cred.identityId, { passwordHash: await hashPassword(newPassword), recoveryHash: null, recoveryExpiresAt: null, recoveryUsedAt: this.now() });
    // Reset revoga TODAS as sessões da identidade (roubo de e-mail não herda sessão).
    const sessions = await this.repo.listSessionsByIdentity(cred.identityId);
    for (const s of sessions) {
      if (s.status === 'ACTIVE') await this.repo.updateSession(s.id, { status: 'REVOKED', revokedReason: 'PASSWORD_CHANGED' });
      await this.repo.revokeFamilyTokens(s.familyId, 'REVOKED').catch(() => 0);
    }
    await this.repo.updateIdentity(cred.identityId, { failedAttempts: 0, lockedUntil: null, status: IDENTITY_STATUS.ACTIVE });
    await this.repo.emitOutbox({ eventId: newId(), aggregate: 'user_identity', aggregateId: cred.identityId, type: OUTBOX_TYPES.PasswordChanged, payload: { identityId: cred.identityId, via: 'reset' } });
    return { ...GENERIC_OK };
  }

  async changePassword(identityId: string, currentPassword: string, newPassword: string, keepSessionId?: string): Promise<{ ok: true }> {
    const policy = validatePasswordPolicy(newPassword);
    if (policy.length > 0) throw new AuthError(policy[0], 400);
    const cred = await this.repo.findCredentialByIdentityId(identityId);
    if (!cred || !cred.passwordHash) throw new AuthError('INVALID_CREDENTIALS', 401);
    const ok = await verifyPassword(cred.passwordHash, currentPassword).catch(() => false);
    if (!ok) throw new AuthError('INVALID_CREDENTIALS', 401, 'Credenciais inválidas.');
    await this.repo.updateCredential(identityId, { passwordHash: await hashPassword(newPassword) });
    const sessions = await this.repo.listSessionsByIdentity(identityId);
    for (const s of sessions) {
      if (s.status === 'ACTIVE' && s.id !== keepSessionId) {
        await this.repo.updateSession(s.id, { status: 'REVOKED', revokedReason: 'PASSWORD_CHANGED' });
        await this.repo.revokeFamilyTokens(s.familyId, 'REVOKED').catch(() => 0);
      }
    }
    await this.repo.emitOutbox({ eventId: newId(), aggregate: 'user_identity', aggregateId: identityId, type: OUTBOX_TYPES.PasswordChanged, payload: { identityId, via: 'change' } });
    return { ...GENERIC_OK };
  }

  // --------------------------------------------------------------------- MFA
  async mfaEnroll(identityId: string): Promise<{ secret: string; otpauthUrl: string; warning: string }> {
    const identity = await this.repo.findIdentityById(identityId);
    if (!identity) throw new AuthError('NOT_FOUND', 404);
    const secret = newMfaSecret();
    await this.repo.updateCredential(identityId, { mfaSecretEnc: encryptSecret(secret, this.encKey()), mfaVerifiedAt: null });
    return { secret, otpauthUrl: mfaOtpauthUrl(secret, identity.emailDisplay), warning: 'SHOW_ONCE' };
  }

  async mfaVerifyEnrollment(identityId: string, code: string, atMs?: number): Promise<{ ok: true }> {
    const cred = await this.repo.findCredentialByIdentityId(identityId);
    if (!cred?.mfaSecretEnc) throw new AuthError('MFA_NOT_ENROLLED', 400);
    const secret = decryptSecret(cred.mfaSecretEnc, this.encKey());
    if (!verifyTotp(secret, code, atMs ?? +this.now())) {
      // E7 (Fase 9): falha de verificação do enroll — trilha best-effort.
      void emitSecurityEvent(getSecurityEventPool(), {
        type: 'MFA_FAILED',
        actorId: identityId,
        entity: 'user_identity',
        entityId: identityId,
        metadata: { reason: 'MFA_INVALID_CODE' },
      });
      throw new AuthError('MFA_INVALID_CODE', 401);
    }
    await this.repo.updateCredential(identityId, { mfaVerifiedAt: this.now() });
    await this.repo.updateIdentity(identityId, { mfaEnabled: true });
    return { ...GENERIC_OK };
  }

  async mfaCompleteLogin(ticket: string, code: string, deviceLabel?: string, atMs?: number): Promise<LoginResult> {
    let sub: string;
    try {
      sub = verifyMfaTicket(ticket, this.secret, { issuer: this.issuer, audience: this.audience }).sub;
    } catch {
      throw new AuthError('INVALID_TOKEN', 401, 'Sessão inválida.');
    }
    const identity = await this.repo.findIdentityById(sub);
    if (!identity || identity.status === IDENTITY_STATUS.DELETED) throw new AuthError('INVALID_TOKEN', 401, 'Sessão inválida.');
    await this.checkLock(identity);
    const cred = await this.repo.findCredentialByIdentityId(sub);
    if (!cred?.mfaSecretEnc || !identity.mfaEnabled) throw new AuthError('MFA_NOT_ENROLLED', 400);
    const secret = decryptSecret(cred.mfaSecretEnc, this.encKey());
    if (!verifyTotp(secret, code, atMs ?? +this.now())) {
      await this.failAttempt(sub, identity.failedAttempts);
      // E7 (Fase 9): falha de MFA no login — trilha best-effort (decisão inalterada).
      void emitSecurityEvent(getSecurityEventPool(), {
        type: 'MFA_FAILED',
        actorId: sub,
        entity: 'user_identity',
        entityId: sub,
        metadata: { reason: 'MFA_INVALID_CODE' },
      });
      throw new AuthError('MFA_INVALID_CODE', 401, 'Código MFA inválido.');
    }
    await this.repo.updateIdentity(sub, { failedAttempts: 0, lockedUntil: null });
    return this.issueSession(sub, deviceLabel ?? null, true);
  }

  // ------------------------------------------------------------------- gdpr
  // Fase 6 (LGPD, stub→real mínimo). Escopo do domínio auth: identidade,
  // sessões e consents. Sem cross-DB: a vigência de licença vive no domínio
  // customers — o bloqueio 409 `ACTIVE com vigência` é aplicado lá
  // (CustomersService.anonymize). Ordem canônica no runbook: customers
  // primeiro (pode negar 409), depois auth (este método).
  // - export: JSON portável, e-mail MASCARADO, sem passwordHash, sem hashes
  //   de token, sem segredo MFA.
  // - anonymize: revoga sessões/famílias, limpa credencial/segredos, apaga
  //   identificadores diretos (e-mail), marca DELETED, emite outbox sem PII.
  async exportData(identityId: string): Promise<{
    identity: {
      id: string;
      emailMasked: string;
      status: string;
      emailVerified: boolean;
      mfaEnabled: boolean;
      createdAt: Date;
    };
    sessions: Array<{
      id: string;
      deviceLabel: string | null;
      status: string;
      expiresAt: Date;
      lastSeenAt: Date;
    }>;
    consents: Array<{ type: string; version: string; acceptedAt: Date }>;
  }> {
    const identity = await this.repo.findIdentityById(identityId);
    if (!identity || identity.status === IDENTITY_STATUS.DELETED) {
      throw new AuthError('NOT_FOUND', 404, 'Identidade não encontrada.');
    }
    const sessions = await this.repo.listSessionsByIdentity(identityId);
    const consents = await this.repo.listConsentsByIdentity(identityId);
    return {
      identity: {
        id: identity.id,
        emailMasked: maskEmail(identity.emailDisplay),
        status: identity.status,
        emailVerified: identity.emailVerifiedAt !== null,
        mfaEnabled: identity.mfaEnabled,
        createdAt: identity.createdAt,
      },
      sessions: sessions.map((s) => ({
        id: s.id,
        deviceLabel: s.deviceLabel,
        status: s.status,
        expiresAt: s.expiresAt,
        lastSeenAt: s.lastSeenAt,
      })),
      consents: consents.map((c) => ({ type: c.type, version: c.version, acceptedAt: c.acceptedAt })),
    };
  }

  async anonymize(identityId: string): Promise<{ ok: true }> {
    const identity = await this.repo.findIdentityById(identityId);
    if (!identity || identity.status === IDENTITY_STATUS.DELETED) {
      throw new AuthError('NOT_FOUND', 404, 'Identidade não encontrada.');
    }
    // 1. Revoga todas as sessões e famílias de refresh desta identidade.
    const sessions = await this.repo.listSessionsByIdentity(identityId);
    const families = new Set(sessions.map((s) => s.familyId));
    for (const s of sessions) {
      if (s.status === 'ACTIVE') {
        await this.repo.updateSession(s.id, { status: 'REVOKED', revokedReason: 'GDPR_ERASURE' });
      }
    }
    for (const familyId of families) {
      await this.repo.revokeFamilySessions(familyId, 'GDPR_ERASURE').catch(() => 0);
      await this.repo.revokeFamilyTokens(familyId, 'REVOKED').catch(() => 0);
    }
    // 2. Limpa segredos da credencial (senha, recovery, MFA). Sem credencial → segue.
    await this.repo
      .updateCredential(identityId, {
        passwordHash: '',
        recoveryHash: null,
        recoveryExpiresAt: null,
        recoveryUsedAt: this.now(),
        mfaSecretEnc: null,
        mfaVerifiedAt: null,
      })
      .catch(() => undefined);
    // 3. Apaga identificadores diretos; mantém o id opaco p/ trilha/auditoria (LGPD art. 16).
    const anon = `anon_${identity.id}@anonymized.local`;
    await this.repo.updateIdentity(identityId, {
      status: IDENTITY_STATUS.DELETED,
      emailNorm: anon,
      emailDisplay: anon,
      failedAttempts: 0,
      lockedUntil: null,
      mfaEnabled: false,
    });
    await this.repo.emitOutbox({
      eventId: newId(),
      aggregate: 'user_identity',
      aggregateId: identityId,
      type: OUTBOX_TYPES.IdentityAnonymized,
      payload: { identityId },
    });
    return { ...GENERIC_OK };
  }

  // ----------------------------------------------------------------- guards
  verifyAccess(token: string): { identityId: string; sessionId: string; familyId: string; mfa: boolean } {
    try {
      const c = verifyAccessToken(token, this.secret, { issuer: this.issuer, audience: this.audience });
      return { identityId: c.sub, sessionId: c.sid, familyId: c.fid, mfa: c.mfa };
    } catch (e: any) {
      const code = e?.code === 'JWT_EXPIRED' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED';
      throw new AuthError(code, 401, 'Não autorizado.');
    }
  }

  async assertSessionActive(sessionId: string, identityId: string): Promise<void> {
    const s = await this.repo.findSessionById(sessionId);
    if (!s || s.identityId !== identityId || s.status !== 'ACTIVE' || +s.expiresAt <= +this.now()) {
      throw new AuthError('SESSION_INVALID', 401, 'Sessão inválida.');
    }
  }
}
