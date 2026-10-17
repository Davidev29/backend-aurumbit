import { Inject, Injectable, Optional } from '@nestjs/common';
import { AUTH_POOL, getSharedAuthPool } from '../../modules/auth/auth-pool.provider';
import type { AuthSessionStatus, SessionLookup, SessionRecord } from './session-lookup.port';

// Adaptador PG p/ `SESSION_LOOKUP` (auth.sessions reais; Fase 3+).
// D2-5: usa o POOL COMPARTILHADO do domínio auth (`AUTH_POOL` /
// `getSharedAuthPool()`) — antes abria um segundo `new Pool()` sobre o mesmo
// `DATABASE_URL_AUTH` (2 pools vs `default_pool_size = 20` do PgBouncer) e sem
// `max`/`idleTimeoutMillis`/`connectionTimeoutMillis`, o que no `pg` significa
// espera infinita por conexão. Sem DB configurado, `findById` retorna null
// (default-deny) em vez de lançar.
type PgPool = any;

@Injectable()
export class PgSessionLookup implements SessionLookup {
  constructor(@Optional() @Inject(AUTH_POOL) private readonly pool?: PgPool | null) {}

  private db(): PgPool | null {
    // Provider disponível (AuthModule) ou o singleton de processo — os dois
    // caminhos devolvem o MESMO pool, então nunca há dois. Sem `DATABASE_URL_*`
    // o singleton é `null` = default-deny (comportamento anterior).
    return this.pool ?? getSharedAuthPool();
  }

  async findById(sid: string): Promise<SessionRecord | null> {
    const pool = this.db();
    if (!pool) return null;
    const { rows } = await pool.query(
      // D2-6: schema-qualified — `?schema=auth` é NO-OP no `pg` (allowlist
      // fixa de chaves da connection string), então sem o prefixo a query
      // dependeria do `search_path` do role/PgBouncer para não dar 42P01.
      `SELECT id, identity_id AS "identityId", status, expires_at AS "expiresAt",
              revoked_reason AS "revokedReason"
       FROM auth.auth_sessions WHERE id = $1 LIMIT 1`,
      [sid],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    const status = String(r.status).toUpperCase();
    if (status !== 'ACTIVE' && status !== 'REVOKED' && status !== 'EXPIRED') return null;
    return {
      id: String(r.id),
      identityId: String(r.identityId),
      status: status as AuthSessionStatus,
      expiresAt: new Date(r.expiresAt),
      revokedAt: r.revokedReason ? new Date() : null,
    };
  }
}
