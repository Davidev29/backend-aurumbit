import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FINANCE_POOL } from './finance-pool.provider';

// Notificações in-system do financeiro (sino do terminal administrativo).
// Idempotência (PROJECT.md §5): `UNIQUE(eventId)` — replay do mesmo evento
// retorna a linha existente sem duplicar. Leitura/marcação escopadas por
// orgId (WHERE orgId). Sem PII além do já operacional (título/corpo sem
// código de barras integral — só máscara).

export type FinanceNotificationSeverity = 'INFO' | 'WARN' | 'ERROR';

export interface FinanceNotification {
  id: string;
  orgId: string;
  eventId: string;
  kind: string;
  title: string;
  body: string;
  severity: FinanceNotificationSeverity;
  read: boolean;
  createdAt: unknown;
}

const NOTIF_COLS = `id, "orgId", "eventId", kind, title, body, severity, "read", "createdAt"`;

interface PoolLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

@Injectable()
export class FinanceNotificationsService {
  private readonly logger = new Logger(FinanceNotificationsService.name);

  constructor(@Inject(FINANCE_POOL) private readonly pool: PoolLike) {}

  /**
   * Registra a notificação. Idempotente por eventId:
   * `ON CONFLICT(eventId) DO NOTHING` → replay retorna a existente.
   */
  async notify(input: {
    orgId: string;
    eventId?: string;
    kind: string;
    title: string;
    body: string;
    severity?: FinanceNotificationSeverity;
  }): Promise<FinanceNotification> {
    const eventId = input.eventId ?? randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO finance_notifications (id, "orgId", "eventId", kind, title, body, severity, "read", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,now())
       ON CONFLICT ("eventId") DO NOTHING
       RETURNING ${NOTIF_COLS}`,
      [randomUUID(), input.orgId, eventId, input.kind, input.title, input.body, input.severity ?? 'INFO'],
    );
    if (rows.length > 0) return rows[0] as unknown as FinanceNotification;
    const { rows: existing } = await this.pool.query(
      `SELECT ${NOTIF_COLS} FROM finance_notifications WHERE "eventId" = $1 AND "orgId" = $2`,
      [eventId, input.orgId],
    );
    return existing[0] as unknown as FinanceNotification;
  }

  async list(orgId: string, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<{
    data: FinanceNotification[];
    unread: number;
  }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const { rows } = await this.pool.query(
      `SELECT ${NOTIF_COLS} FROM finance_notifications WHERE "orgId" = $1` +
        (opts.unreadOnly ? ` AND "read" = false` : ``) +
        ` ORDER BY "createdAt" DESC, id DESC LIMIT ${limit}`,
      [orgId],
    );
    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS unread FROM finance_notifications WHERE "orgId" = $1 AND "read" = false`,
      [orgId],
    );
    return {
      data: rows as unknown as FinanceNotification[],
      unread: Number((countRows[0] as { unread?: number })?.unread ?? 0),
    };
  }

  /** Marca como lida (idempotente: já lida → retorna a linha). */
  async markRead(orgId: string, id: string): Promise<FinanceNotification | null> {
    const { rows } = await this.pool.query(
      `UPDATE finance_notifications SET "read" = true WHERE id = $1 AND "orgId" = $2 RETURNING ${NOTIF_COLS}`,
      [id, orgId],
    );
    if (rows.length > 0) return rows[0] as unknown as FinanceNotification;
    const { rows: existing } = await this.pool.query(
      `SELECT ${NOTIF_COLS} FROM finance_notifications WHERE id = $1 AND "orgId" = $2`,
      [id, orgId],
    );
    return (existing[0] as unknown as FinanceNotification) ?? null;
  }
}
