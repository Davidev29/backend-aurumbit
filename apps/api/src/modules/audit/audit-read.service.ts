import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { AUDIT_POOL } from './audit-pool.provider';

const AUDIT_EVENT_COLS = `id, "actorId", action, entity, "entityId", metadata, "createdAt"`;

// Leitura PG de `audit.audit_events` (só SELECT; append-only — sem
// UPDATE/DELETE). Serviço separado do `AuditService` em memória (cujo
// contrato append-only é travado por `audit-security.spec.ts`).
// Filtros → colunas reais: actor → "actorId", resource → entity,
// correlation_id → metadata->>'correlationId', from/to → "createdAt".
// Paginação keyset ordenada ("createdAt", id); cursor = id opaco.
@Injectable()
export class AuditReadService {
  constructor(@Inject(AUDIT_POOL) private readonly pool: Pool) {}

  async listEvents(filters: {
    actor?: string;
    resource?: string;
    correlationId?: string;
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ data: unknown[]; meta: { nextCursor: string | null; limit: number } }> {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.actor) {
      params.push(filters.actor);
      conds.push(`"actorId" = $${params.length}`);
    }
    if (filters.resource) {
      params.push(filters.resource);
      conds.push(`entity = $${params.length}`);
    }
    if (filters.correlationId) {
      params.push(filters.correlationId);
      conds.push(`metadata ->> 'correlationId' = $${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from);
      conds.push(`"createdAt" >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      conds.push(`"createdAt" <= $${params.length}`);
    }
    if (filters.cursor) {
      const { rows: anchor } = await this.pool.query(
        `SELECT "createdAt", id FROM audit_events WHERE id = $1`,
        [filters.cursor],
      );
      // Cursor desconhecido → ignora (começa do início; documentado).
      if (anchor.length > 0) {
        params.push(anchor[0].createdAt, filters.cursor);
        conds.push(`(("createdAt", id) > ($${params.length - 1}, $${params.length}))`);
      }
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit + 1);
    const { rows } = await this.pool.query(
      `SELECT ${AUDIT_EVENT_COLS} FROM audit_events ${where} ORDER BY "createdAt", id LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      data,
      meta: { nextCursor: hasMore && data.length > 0 ? (data[data.length - 1] as { id: string }).id : null, limit },
    };
  }
}
