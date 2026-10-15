import { newId } from './crypto';

/** Token de DI do repositório auth (evita import circular com auth.module). */
export const AUTH_REPOSITORY = 'AUTH_REPOSITORY';

// ---------------------------------------------------------------------------
// Camada de persistência do domínio auth (DB `auth` apenas).
// Colunas espelham prisma/auth/schema.prisma 1:1. Sem FK cross-schema.
// Dois backends: InMemoryAuthRepository (testes unitários, sem infra) e
// PgAuthRepository (pg Pool lazy; tabelas criadas pelas migrações Prisma).
// ---------------------------------------------------------------------------

export interface IdentityRow {
  id: string;
  emailNorm: string;
  emailDisplay: string;
  status: string;
  emailVerifiedAt: Date | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  mfaEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CredentialRow {
  id: string;
  identityId: string;
  passwordHash: string;
  recoveryHash: string | null;
  recoveryExpiresAt: Date | null;
  recoveryUsedAt: Date | null;
  mfaSecretEnc: string | null;
  mfaVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRow {
  id: string;
  identityId: string;
  familyId: string;
  deviceLabel: string | null;
  status: string;
  revokedReason: string | null;
  expiresAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
}

export interface RefreshTokenRow {
  id: string;
  sessionId: string;
  familyId: string;
  tokenHash: string;
  parentHash: string | null;
  status: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  createdAt: Date;
}

export interface VerificationRow {
  id: string;
  identityId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface ConsentRow {
  id: string;
  identityId: string;
  type: string;
  version: string;
  acceptedAt: Date;
}

export interface IAuthRepository {
  // identities
  findIdentityByEmailNorm(emailNorm: string): Promise<IdentityRow | null>;
  findIdentityById(id: string): Promise<IdentityRow | null>;
  createIdentity(input: { emailNorm: string; emailDisplay: string; status: string }): Promise<IdentityRow>;
  // Fase 6 (LGPD): patch admite emailNorm/emailDisplay p/ anonimização
  // (apaga identificadores diretos, mantém o id opaco p/ trilha/auditoria).
  updateIdentity(id: string, patch: Partial<Pick<IdentityRow, 'status' | 'emailNorm' | 'emailDisplay' | 'emailVerifiedAt' | 'failedAttempts' | 'lockedUntil' | 'mfaEnabled'>>): Promise<IdentityRow>;
  // credentials
  findCredentialByIdentityId(identityId: string): Promise<CredentialRow | null>;
  findCredentialByRecoveryHash(hash: string): Promise<CredentialRow | null>;
  createCredential(input: { identityId: string; passwordHash: string }): Promise<CredentialRow>;
  updateCredential(identityId: string, patch: Partial<Pick<CredentialRow, 'passwordHash' | 'recoveryHash' | 'recoveryExpiresAt' | 'recoveryUsedAt' | 'mfaSecretEnc' | 'mfaVerifiedAt'>>): Promise<CredentialRow>;
  // sessions
  createSession(input: { identityId: string; familyId: string; deviceLabel: string | null; expiresAt: Date }): Promise<SessionRow>;
  findSessionById(id: string): Promise<SessionRow | null>;
  listSessionsByIdentity(identityId: string): Promise<SessionRow[]>;
  updateSession(id: string, patch: Partial<Pick<SessionRow, 'status' | 'revokedReason' | 'lastSeenAt' | 'expiresAt'>>): Promise<SessionRow>;
  revokeFamilySessions(familyId: string, reason: string, exceptSessionId?: string): Promise<number>;
  // refresh tokens
  createRefreshToken(input: { sessionId: string; familyId: string; tokenHash: string; parentHash: string | null; expiresAt: Date }): Promise<RefreshTokenRow>;
  findRefreshTokenByHash(hash: string): Promise<RefreshTokenRow | null>;
  updateRefreshToken(id: string, patch: Partial<Pick<RefreshTokenRow, 'status' | 'rotatedAt'>>): Promise<RefreshTokenRow>;
  revokeFamilyTokens(familyId: string, reasonStatus: string): Promise<number>;
  // verification / consents / outbox
  createVerificationToken(input: { identityId: string; tokenHash: string; expiresAt: Date }): Promise<VerificationRow>;
  findVerificationTokenByHash(hash: string): Promise<VerificationRow | null>;
  consumeVerificationToken(id: string): Promise<void>;
  createConsent(input: { identityId: string; type: string; version: string }): Promise<ConsentRow>;
  // Fase 6 (LGPD export): lista aceites versionados do titular (sem PII além do identityId opaco).
  listConsentsByIdentity(identityId: string): Promise<ConsentRow[]>;
  emitOutbox(input: { eventId: string; aggregate: string; aggregateId: string; type: string; payload: unknown }): Promise<void>;
}

function clone<T>(v: T): T {
  // Deep clone preservando Date (JSON puro converteria Date→string via
  // toJSON antes do replacer, quebrando comparações de expiração/lock).
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return new Date(+v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => clone(x)) as unknown as T;
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = clone(x);
    return out as T;
  }
  return v;
}

// ---------------------------------------------------------------------------
// In-memory (testes). Respeita UNIQUEs: email_norm, recovery_hash (não-nulo),
// token_hash (refresh + verification).
// ---------------------------------------------------------------------------

export class InMemoryAuthRepository implements IAuthRepository {
  identities = new Map<string, IdentityRow>();
  credentials = new Map<string, CredentialRow>(); // key identityId
  sessions = new Map<string, SessionRow>();
  refreshTokens = new Map<string, RefreshTokenRow>(); // key tokenHash
  verifications = new Map<string, VerificationRow>(); // key tokenHash
  consents: ConsentRow[] = [];
  outbox: Array<{ eventId: string; aggregate: string; aggregateId: string; type: string; payload: unknown }> = [];

  private now(): Date {
    return new Date();
  }

  async findIdentityByEmailNorm(emailNorm: string): Promise<IdentityRow | null> {
    for (const i of this.identities.values()) if (i.emailNorm === emailNorm) return clone(i);
    return null;
  }
  async findIdentityById(id: string): Promise<IdentityRow | null> {
    const r = this.identities.get(id);
    return r ? clone(r) : null;
  }
  async createIdentity(input: { emailNorm: string; emailDisplay: string; status: string }): Promise<IdentityRow> {
    const t = this.now();
    const row: IdentityRow = { id: newId(), emailNorm: input.emailNorm, emailDisplay: input.emailDisplay, status: input.status, emailVerifiedAt: null, failedAttempts: 0, lockedUntil: null, mfaEnabled: false, createdAt: t, updatedAt: t };
    this.identities.set(row.id, row);
    return clone(row);
  }
  async updateIdentity(id: string, patch: Partial<Pick<IdentityRow, 'status' | 'emailNorm' | 'emailDisplay' | 'emailVerifiedAt' | 'failedAttempts' | 'lockedUntil' | 'mfaEnabled'>>): Promise<IdentityRow> {
    const cur = this.identities.get(id);
    if (!cur) throw new Error('IDENTITY_NOT_FOUND');
    const next = { ...cur, ...patch, updatedAt: this.now() };
    this.identities.set(id, next);
    return clone(next);
  }
  async findCredentialByIdentityId(identityId: string): Promise<CredentialRow | null> {
    const r = this.credentials.get(identityId);
    return r ? clone(r) : null;
  }
  async findCredentialByRecoveryHash(hash: string): Promise<CredentialRow | null> {
    for (const c of this.credentials.values()) if (c.recoveryHash === hash) return clone(c);
    return null;
  }
  async createCredential(input: { identityId: string; passwordHash: string }): Promise<CredentialRow> {
    const t = this.now();
    const row: CredentialRow = { id: newId(), identityId: input.identityId, passwordHash: input.passwordHash, recoveryHash: null, recoveryExpiresAt: null, recoveryUsedAt: null, mfaSecretEnc: null, mfaVerifiedAt: null, createdAt: t, updatedAt: t };
    this.credentials.set(input.identityId, row);
    return clone(row);
  }
  async updateCredential(identityId: string, patch: Partial<Pick<CredentialRow, 'passwordHash' | 'recoveryHash' | 'recoveryExpiresAt' | 'recoveryUsedAt' | 'mfaSecretEnc' | 'mfaVerifiedAt'>>): Promise<CredentialRow> {
    const cur = this.credentials.get(identityId);
    if (!cur) throw new Error('CREDENTIAL_NOT_FOUND');
    if (patch.recoveryHash !== undefined && patch.recoveryHash !== null) {
      for (const c of this.credentials.values()) {
        if (c.identityId !== identityId && c.recoveryHash === patch.recoveryHash) throw new Error('RECOVERY_HASH_CONFLICT');
      }
    }
    const next = { ...cur, ...patch, updatedAt: this.now() };
    this.credentials.set(identityId, next);
    return clone(next);
  }
  async createSession(input: { identityId: string; familyId: string; deviceLabel: string | null; expiresAt: Date }): Promise<SessionRow> {
    const row: SessionRow = { id: newId(), identityId: input.identityId, familyId: input.familyId, deviceLabel: input.deviceLabel, status: 'ACTIVE', revokedReason: null, expiresAt: input.expiresAt, lastSeenAt: this.now(), createdAt: this.now() };
    this.sessions.set(row.id, row);
    return clone(row);
  }
  async findSessionById(id: string): Promise<SessionRow | null> {
    const r = this.sessions.get(id);
    return r ? clone(r) : null;
  }
  async listSessionsByIdentity(identityId: string): Promise<SessionRow[]> {
    return [...this.sessions.values()].filter((s) => s.identityId === identityId).map(clone).sort((a, b) => +b.lastSeenAt - +a.lastSeenAt);
  }
  async updateSession(id: string, patch: Partial<Pick<SessionRow, 'status' | 'revokedReason' | 'lastSeenAt' | 'expiresAt'>>): Promise<SessionRow> {
    const cur = this.sessions.get(id);
    if (!cur) throw new Error('SESSION_NOT_FOUND');
    const next = { ...cur, ...patch };
    this.sessions.set(id, next);
    return clone(next);
  }
  async revokeFamilySessions(familyId: string, reason: string, exceptSessionId?: string): Promise<number> {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.familyId === familyId && s.status === 'ACTIVE' && s.id !== exceptSessionId) {
        s.status = 'REVOKED';
        s.revokedReason = reason;
        n++;
      }
    }
    return n;
  }
  async createRefreshToken(input: { sessionId: string; familyId: string; tokenHash: string; parentHash: string | null; expiresAt: Date }): Promise<RefreshTokenRow> {
    if (this.refreshTokens.has(input.tokenHash)) throw new Error('TOKEN_HASH_CONFLICT');
    const row: RefreshTokenRow = { id: newId(), sessionId: input.sessionId, familyId: input.familyId, tokenHash: input.tokenHash, parentHash: input.parentHash, status: 'ACTIVE', expiresAt: input.expiresAt, rotatedAt: null, createdAt: this.now() };
    this.refreshTokens.set(row.tokenHash, row);
    return clone(row);
  }
  async findRefreshTokenByHash(hash: string): Promise<RefreshTokenRow | null> {
    const r = this.refreshTokens.get(hash);
    return r ? clone(r) : null;
  }
  async updateRefreshToken(id: string, patch: Partial<Pick<RefreshTokenRow, 'status' | 'rotatedAt'>>): Promise<RefreshTokenRow> {
    for (const [k, v] of this.refreshTokens.entries()) {
      if (v.id === id) {
        const next = { ...v, ...patch };
        this.refreshTokens.set(k, next);
        return clone(next);
      }
    }
    throw new Error('TOKEN_NOT_FOUND');
  }
  async revokeFamilyTokens(familyId: string, reasonStatus: string): Promise<number> {
    let n = 0;
    for (const t of this.refreshTokens.values()) {
      if (t.familyId === familyId && t.status === 'ACTIVE') {
        t.status = reasonStatus;
        n++;
      }
    }
    return n;
  }
  async createVerificationToken(input: { identityId: string; tokenHash: string; expiresAt: Date }): Promise<VerificationRow> {
    const row: VerificationRow = { id: newId(), identityId: input.identityId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, consumedAt: null, createdAt: this.now() };
    this.verifications.set(row.tokenHash, row);
    return clone(row);
  }
  async findVerificationTokenByHash(hash: string): Promise<VerificationRow | null> {
    const r = this.verifications.get(hash);
    return r ? clone(r) : null;
  }
  async consumeVerificationToken(id: string): Promise<void> {
    for (const v of this.verifications.values()) if (v.id === id) v.consumedAt = this.now();
  }
  async createConsent(input: { identityId: string; type: string; version: string }): Promise<ConsentRow> {
    const row: ConsentRow = { id: newId(), identityId: input.identityId, type: input.type, version: input.version, acceptedAt: this.now() };
    this.consents.push(row);
    return clone(row);
  }
  async listConsentsByIdentity(identityId: string): Promise<ConsentRow[]> {
    return this.consents.filter((c) => c.identityId === identityId).map(clone);
  }
  async emitOutbox(input: { eventId: string; aggregate: string; aggregateId: string; type: string; payload: unknown }): Promise<void> {
    this.outbox.push({ ...input });
  }
}

// ---------------------------------------------------------------------------
// Postgres via pg (Pool lazy). Import untyped de propósito: apps/api não
// declara @prisma/client nem @types/pg; noImplicitAny=false permite `any`.
// ---------------------------------------------------------------------------

type PgPool = any;

export class PgAuthRepository implements IAuthRepository {
  private pool: PgPool | null = null;
  constructor(private readonly connectionString?: string) {}

  private db(): PgPool {
    if (this.pool) return this.pool;
    const cs = this.connectionString ?? process.env.DATABASE_URL_AUTH ?? process.env.DATABASE_URL;
    if (!cs) throw new Error('auth DB indisponível: defina DATABASE_URL_AUTH.');
    // require lazy p/ não quebrar em ambientes sem o driver instalado.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString: cs });
    return this.pool;
  }

  private static mapIdentity(r: any): IdentityRow {
    return { id: r.id, emailNorm: r.email_norm, emailDisplay: r.email_display, status: r.status, emailVerifiedAt: r.email_verified_at, failedAttempts: r.failed_attempts, lockedUntil: r.locked_until, mfaEnabled: r.mfa_enabled, createdAt: r.createdAt, updatedAt: r.updatedAt };
  }
  private static mapCredential(r: any): CredentialRow {
    return { id: r.id, identityId: r.identity_id, passwordHash: r.password_hash, recoveryHash: r.recovery_hash, recoveryExpiresAt: r.recovery_expires_at, recoveryUsedAt: r.recovery_used_at, mfaSecretEnc: r.mfa_secret_enc, mfaVerifiedAt: r.mfa_verified_at, createdAt: r.createdAt, updatedAt: r.updatedAt };
  }
  private static mapSession(r: any): SessionRow {
    return { id: r.id, identityId: r.identity_id, familyId: r.family_id, deviceLabel: r.device_label, status: r.status, revokedReason: r.revoked_reason, expiresAt: r.expires_at, lastSeenAt: r.last_seen_at, createdAt: r.createdAt };
  }
  private static mapToken(r: any): RefreshTokenRow {
    return { id: r.id, sessionId: r.session_id, familyId: r.family_id, tokenHash: r.token_hash, parentHash: r.parent_hash, status: r.status, expiresAt: r.expires_at, rotatedAt: r.rotated_at, createdAt: r.createdAt };
  }

  async findIdentityByEmailNorm(emailNorm: string): Promise<IdentityRow | null> {
    const { rows } = await this.db().query('SELECT * FROM user_identities WHERE email_norm = $1 LIMIT 1', [emailNorm]);
    return rows[0] ? PgAuthRepository.mapIdentity(rows[0]) : null;
  }
  async findIdentityById(id: string): Promise<IdentityRow | null> {
    const { rows } = await this.db().query('SELECT * FROM user_identities WHERE id = $1 LIMIT 1', [id]);
    return rows[0] ? PgAuthRepository.mapIdentity(rows[0]) : null;
  }
  async createIdentity(input: { emailNorm: string; emailDisplay: string; status: string }): Promise<IdentityRow> {
    const { rows } = await this.db().query(
      'INSERT INTO user_identities (id, email_norm, email_display, status) VALUES ($1,$2,$3,$4) RETURNING *',
      [newId(), input.emailNorm, input.emailDisplay, input.status],
    );
    return PgAuthRepository.mapIdentity(rows[0]);
  }
  async updateIdentity(id: string, patch: Partial<Pick<IdentityRow, 'status' | 'emailNorm' | 'emailDisplay' | 'emailVerifiedAt' | 'failedAttempts' | 'lockedUntil' | 'mfaEnabled'>>): Promise<IdentityRow> {
    const sets: string[] = ['"updatedAt" = now()'];
    const vals: any[] = [];
    const push = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (patch.status !== undefined) push('status', patch.status);
    if (patch.emailNorm !== undefined) push('email_norm', patch.emailNorm);
    if (patch.emailDisplay !== undefined) push('email_display', patch.emailDisplay);
    if (patch.emailVerifiedAt !== undefined) push('email_verified_at', patch.emailVerifiedAt);
    if (patch.failedAttempts !== undefined) push('failed_attempts', patch.failedAttempts);
    if (patch.lockedUntil !== undefined) push('locked_until', patch.lockedUntil);
    if (patch.mfaEnabled !== undefined) push('mfa_enabled', patch.mfaEnabled);
    vals.push(id);
    const { rows } = await this.db().query(`UPDATE user_identities SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows[0]) throw new Error('IDENTITY_NOT_FOUND');
    return PgAuthRepository.mapIdentity(rows[0]);
  }
  async findCredentialByIdentityId(identityId: string): Promise<CredentialRow | null> {
    const { rows } = await this.db().query('SELECT * FROM credentials WHERE identity_id = $1 LIMIT 1', [identityId]);
    return rows[0] ? PgAuthRepository.mapCredential(rows[0]) : null;
  }
  async findCredentialByRecoveryHash(hash: string): Promise<CredentialRow | null> {
    const { rows } = await this.db().query('SELECT * FROM credentials WHERE recovery_hash = $1 LIMIT 1', [hash]);
    return rows[0] ? PgAuthRepository.mapCredential(rows[0]) : null;
  }
  async createCredential(input: { identityId: string; passwordHash: string }): Promise<CredentialRow> {
    const { rows } = await this.db().query('INSERT INTO credentials (id, identity_id, password_hash) VALUES ($1,$2,$3) RETURNING *', [newId(), input.identityId, input.passwordHash]);
    return PgAuthRepository.mapCredential(rows[0]);
  }
  async updateCredential(identityId: string, patch: Partial<Pick<CredentialRow, 'passwordHash' | 'recoveryHash' | 'recoveryExpiresAt' | 'recoveryUsedAt' | 'mfaSecretEnc' | 'mfaVerifiedAt'>>): Promise<CredentialRow> {
    const sets: string[] = ['"updatedAt" = now()'];
    const vals: any[] = [];
    const push = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (patch.passwordHash !== undefined) push('password_hash', patch.passwordHash);
    if (patch.recoveryHash !== undefined) push('recovery_hash', patch.recoveryHash);
    if (patch.recoveryExpiresAt !== undefined) push('recovery_expires_at', patch.recoveryExpiresAt);
    if (patch.recoveryUsedAt !== undefined) push('recovery_used_at', patch.recoveryUsedAt);
    if (patch.mfaSecretEnc !== undefined) push('mfa_secret_enc', patch.mfaSecretEnc);
    if (patch.mfaVerifiedAt !== undefined) push('mfa_verified_at', patch.mfaVerifiedAt);
    vals.push(identityId);
    const { rows } = await this.db().query(`UPDATE credentials SET ${sets.join(', ')} WHERE identity_id = $${vals.length} RETURNING *`, vals);
    if (!rows[0]) throw new Error('CREDENTIAL_NOT_FOUND');
    return PgAuthRepository.mapCredential(rows[0]);
  }
  async createSession(input: { identityId: string; familyId: string; deviceLabel: string | null; expiresAt: Date }): Promise<SessionRow> {
    const { rows } = await this.db().query(
      'INSERT INTO auth_sessions (id, identity_id, family_id, device_label, status, expires_at) VALUES ($1,$2,$3,$4,\'ACTIVE\',$5) RETURNING *',
      [newId(), input.identityId, input.familyId, input.deviceLabel, input.expiresAt],
    );
    return PgAuthRepository.mapSession(rows[0]);
  }
  async findSessionById(id: string): Promise<SessionRow | null> {
    const { rows } = await this.db().query('SELECT * FROM auth_sessions WHERE id = $1 LIMIT 1', [id]);
    return rows[0] ? PgAuthRepository.mapSession(rows[0]) : null;
  }
  async listSessionsByIdentity(identityId: string): Promise<SessionRow[]> {
    const { rows } = await this.db().query('SELECT * FROM auth_sessions WHERE identity_id = $1 ORDER BY last_seen_at DESC LIMIT 50', [identityId]);
    return rows.map(PgAuthRepository.mapSession);
  }
  async updateSession(id: string, patch: Partial<Pick<SessionRow, 'status' | 'revokedReason' | 'lastSeenAt' | 'expiresAt'>>): Promise<SessionRow> {
    const sets: string[] = [];
    const vals: any[] = [];
    const push = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (patch.status !== undefined) push('status', patch.status);
    if (patch.revokedReason !== undefined) push('revoked_reason', patch.revokedReason);
    if (patch.lastSeenAt !== undefined) push('last_seen_at', patch.lastSeenAt);
    if (patch.expiresAt !== undefined) push('expires_at', patch.expiresAt);
    if (sets.length === 0) {
      const cur = await this.findSessionById(id);
      if (!cur) throw new Error('SESSION_NOT_FOUND');
      return cur;
    }
    vals.push(id);
    const { rows } = await this.db().query(`UPDATE auth_sessions SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows[0]) throw new Error('SESSION_NOT_FOUND');
    return PgAuthRepository.mapSession(rows[0]);
  }
  async revokeFamilySessions(familyId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const { rowCount } = await this.db().query(
      "UPDATE auth_sessions SET status = 'REVOKED', revoked_reason = $1 WHERE family_id = $2 AND status = 'ACTIVE' AND ($3::text IS NULL OR id <> $3)",
      [reason, familyId, exceptSessionId ?? null],
    );
    return rowCount ?? 0;
  }
  async createRefreshToken(input: { sessionId: string; familyId: string; tokenHash: string; parentHash: string | null; expiresAt: Date }): Promise<RefreshTokenRow> {
    const { rows } = await this.db().query(
      "INSERT INTO refresh_tokens (id, session_id, family_id, token_hash, parent_hash, status, expires_at) VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6) RETURNING *",
      [newId(), input.sessionId, input.familyId, input.tokenHash, input.parentHash, input.expiresAt],
    );
    return PgAuthRepository.mapToken(rows[0]);
  }
  async findRefreshTokenByHash(hash: string): Promise<RefreshTokenRow | null> {
    const { rows } = await this.db().query('SELECT * FROM refresh_tokens WHERE token_hash = $1 LIMIT 1', [hash]);
    return rows[0] ? PgAuthRepository.mapToken(rows[0]) : null;
  }
  async updateRefreshToken(id: string, patch: Partial<Pick<RefreshTokenRow, 'status' | 'rotatedAt'>>): Promise<RefreshTokenRow> {
    const sets: string[] = [];
    const vals: any[] = [];
    if (patch.status !== undefined) {
      vals.push(patch.status);
      sets.push(`status = $${vals.length}`);
    }
    if (patch.rotatedAt !== undefined) {
      vals.push(patch.rotatedAt);
      sets.push(`rotated_at = $${vals.length}`);
    }
    vals.push(id);
    const { rows } = await this.db().query(`UPDATE refresh_tokens SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows[0]) throw new Error('TOKEN_NOT_FOUND');
    return PgAuthRepository.mapToken(rows[0]);
  }
  async revokeFamilyTokens(familyId: string, reasonStatus: string): Promise<number> {
    const { rowCount } = await this.db().query("UPDATE refresh_tokens SET status = $1 WHERE family_id = $2 AND status = 'ACTIVE'", [reasonStatus, familyId]);
    return rowCount ?? 0;
  }
  async createVerificationToken(input: { identityId: string; tokenHash: string; expiresAt: Date }): Promise<VerificationRow> {
    const { rows } = await this.db().query('INSERT INTO email_verification_tokens (id, identity_id, token_hash, expires_at) VALUES ($1,$2,$3,$4) RETURNING *', [newId(), input.identityId, input.tokenHash, input.expiresAt]);
    const r = rows[0];
    return { id: r.id, identityId: r.identity_id, tokenHash: r.token_hash, expiresAt: r.expires_at, consumedAt: r.consumed_at, createdAt: r.createdAt };
  }
  async findVerificationTokenByHash(hash: string): Promise<VerificationRow | null> {
    const { rows } = await this.db().query('SELECT * FROM email_verification_tokens WHERE token_hash = $1 LIMIT 1', [hash]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { id: r.id, identityId: r.identity_id, tokenHash: r.token_hash, expiresAt: r.expires_at, consumedAt: r.consumed_at, createdAt: r.createdAt };
  }
  async consumeVerificationToken(id: string): Promise<void> {
    await this.db().query('UPDATE email_verification_tokens SET consumed_at = now() WHERE id = $1', [id]);
  }
  async createConsent(input: { identityId: string; type: string; version: string }): Promise<ConsentRow> {
    const { rows } = await this.db().query('INSERT INTO consent_grants (id, identity_id, type, version) VALUES ($1,$2,$3,$4) ON CONFLICT (identity_id, type, version) DO NOTHING RETURNING *', [newId(), input.identityId, input.type, input.version]);
    const r = rows[0] ?? { id: newId(), identity_id: input.identityId, type: input.type, version: input.version, accepted_at: new Date() };
    return { id: r.id, identityId: r.identity_id ?? input.identityId, type: r.type ?? input.type, version: r.version ?? input.version, acceptedAt: r.accepted_at ?? new Date() };
  }
  async listConsentsByIdentity(identityId: string): Promise<ConsentRow[]> {
    const { rows } = await this.db().query('SELECT * FROM consent_grants WHERE identity_id = $1 ORDER BY accepted_at ASC', [identityId]);
    return rows.map((r: any) => ({ id: r.id, identityId: r.identity_id, type: r.type, version: r.version, acceptedAt: r.accepted_at }));
  }
  async emitOutbox(input: { eventId: string; aggregate: string; aggregateId: string; type: string; payload: unknown }): Promise<void> {
    await this.db().query('INSERT INTO outbox_events (id, "eventId", aggregate, "aggregateId", type, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT ("eventId") DO NOTHING', [newId(), input.eventId, input.aggregate, input.aggregateId, input.type, JSON.stringify(input.payload ?? {})]);
  }
}
