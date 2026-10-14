import { Injectable } from '@nestjs/common';
import type { AuthSessionStatus, SessionLookup, SessionRecord } from './session-lookup.port';

// Adaptador PG p/ `SESSION_LOOKUP` (auth.sessions reais; Fase 3+).
// Lazy como `PgAuthRepository`: pool criado no primeiro uso, nunca no boot.
// Sem DB configurado, `findById` retorna null (default-deny) em vez de lançar.
type PgPool = any;

@Injectable()
export class PgSessionLookup implements SessionLookup {
  private pool: PgPool | null = null;

  private db(): PgPool | null {
    if (this.pool) return this.pool;
    const cs = process.env.DATABASE_URL_AUTH ?? process.env.DATABASE_URL;
    if (!cs) return null;
    // Import lazy de propósito: apps/api não declara `pg` como dependência
    // tipada do módulo (ver PgAuthRepository).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString: cs });
    return this.pool;
  }

  async findById(sid: string): Promise<SessionRecord | null> {
    const pool = this.db();
    if (!pool) return null;
    const { rows } = await pool.query(
      `SELECT id, identity_id AS "identityId", status, expires_at AS "expiresAt",
              revoked_reason AS "revokedReason"
       FROM auth_sessions WHERE id = $1 LIMIT 1`,
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
