import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { COMMUNICATIONS_POOL } from './communications-pool.provider';
import { maskEmail, recipientHash } from './email-address';
import { getTemplate } from './email-templates';

// Serviço de persistência do domínio communications (Fase 4).
// Pool PG próprio (DATABASE_URL_COMMUNICATIONS); sem acesso a outros domínios.
// Idempotência (PROJECT.md §5): `INSERT ... ON CONFLICT ("eventId") DO NOTHING`
// — replay do mesmo evento retorna a linha existente sem reenviar.
// LGPD: persiste só hash + máscara do destinatário e vars REDIGIDAS.

const SECRET_VAR_PATTERNS = ['token', 'secret', 'password', 'code', 'otp', 'pin', 'key_enc', 'licensekey'];

export function redactEmailVars(vars: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) {
    const low = k.toLowerCase();
    out[k] = SECRET_VAR_PATTERNS.some((p) => low.includes(p)) ? '[REDACTED]' : v;
  }
  return out;
}

export type EmailRowStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'BOUNCED' | 'COMPLAINED';

export interface EmailRow {
  id: string;
  eventId: string;
  correlationId: string | null;
  recipientHash: string;
  recipientMasked: string;
  template: string;
  templateVersion: string;
  resendId: string | null;
  status: EmailRowStatus;
  attempts: number;
  lastError: string | null;
}

const SELECT_COLS = `id, "eventId", "correlationId", "recipientHash", "recipientMasked", template, "templateVersion", "resendId", status, attempts, "lastError"`;

export interface RequestEmailInput {
  eventId: string;
  correlationId?: string;
  to: string;
  template: string;
  templateVersion?: string;
  vars: Record<string, unknown>;
}

@Injectable()
export class EmailService {
  constructor(@Inject(COMMUNICATIONS_POOL) private readonly pool: Pool) {}

  /**
   * Registra a intenção de envio. Upsert idempotente por `eventId`:
   * - inseriu → `{ inserted: true }` (worker prossegue p/ o envio);
   * - conflito → `{ inserted: false, status }` (replay: NÃO reenvia; se o
   *   status já for terminal SENT, o worker retorna `duplicate`).
   * Template/versão desconhecidos ou fora de escopo → throw (poison).
   */
  async requestEmail(input: RequestEmailInput): Promise<{ inserted: boolean; status: EmailRowStatus }> {
    if (!input.eventId || input.eventId.length < 8) throw new Error('eventId inválido (mín. 8 chars).');
    if (!input.to || !input.to.includes('@')) throw new Error('destinatário inválido.');
    const version = input.templateVersion ?? 'v1';
    getTemplate(input.template, version); // valida escopo + versão (throw = poison)
    const { rows } = await this.pool.query(
      `INSERT INTO email_messages (id, "eventId", "correlationId", "recipientHash", "recipientMasked",
        template, "templateVersion", status, variables, attempts, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,'QUEUED',$8,0,now(),now())
       ON CONFLICT ("eventId") DO NOTHING
       RETURNING status`,
      [
        randomUUID(),
        input.eventId,
        input.correlationId ?? null,
        recipientHash(input.to),
        maskEmail(input.to),
        input.template,
        version,
        JSON.stringify(redactEmailVars(input.vars ?? {})),
      ],
    );
    if (rows.length > 0) return { inserted: true, status: rows[0].status as EmailRowStatus };
    const existing = await this.getByEventId(input.eventId);
    return { inserted: false, status: existing?.status ?? 'QUEUED' };
  }

  async getByEventId(eventId: string): Promise<EmailRow | null> {
    const { rows } = await this.pool.query(`SELECT ${SELECT_COLS} FROM email_messages WHERE "eventId" = $1`, [
      eventId,
    ]);
    return (rows[0] as EmailRow | undefined) ?? null;
  }

  async getByResendId(resendId: string): Promise<EmailRow | null> {
    const { rows } = await this.pool.query(`SELECT ${SELECT_COLS} FROM email_messages WHERE "resendId" = $1`, [
      resendId,
    ]);
    return (rows[0] as EmailRow | undefined) ?? null;
  }

  /** Marca SENDING (conta tentativa). Retorna false se já saiu de QUEUED/FAILED. */
  async markSending(eventId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE email_messages SET status = 'SENDING', attempts = attempts + 1, "updatedAt" = now()
       WHERE "eventId" = $1 AND status IN ('QUEUED','FAILED')`,
      [eventId],
    );
    return (rowCount ?? 0) > 0;
  }

  async markSent(eventId: string, resendId: string): Promise<void> {
    await this.pool.query(
      `UPDATE email_messages SET status = 'SENT', "resendId" = $2, "sentAt" = now(), "updatedAt" = now()
       WHERE "eventId" = $1`,
      [eventId, resendId],
    );
  }

  async markFailed(eventId: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE email_messages SET status = 'FAILED', "lastError" = $2, "updatedAt" = now()
       WHERE "eventId" = $1`,
      [eventId, error.slice(0, 500)],
    );
  }

  /**
   * Dedupe do webhook Resend por id do evento (`WebhookReceipt.externalId`).
   * Retorna `{ inserted: false }` quando o webhook já foi processado
   * (controller responde 200 duplicate, sem reaplicar).
   */
  async recordWebhookReceipt(input: { externalId: string; emailId?: string; type: string }): Promise<{ inserted: boolean }> {
    const { rows } = await this.pool.query(
      `INSERT INTO webhook_receipts (id, provider, "externalId", "emailId", type, "createdAt")
       VALUES ($1,'resend',$2,$3,$4,now())
       ON CONFLICT ("externalId") DO NOTHING
       RETURNING id`,
      [randomUUID(), input.externalId, input.emailId ?? null, input.type],
    );
    return { inserted: rows.length > 0 };
  }

  /**
   * Aplica o status vindo do webhook Resend, sem regredir terminal:
   * - BOUNCED/COMPLAINED: aplica salvo se já for o próprio valor;
   * - SENT (delivered): só sai de QUEUED/SENDING/FAILED (nunca regride
   *   BOUNCED/COMPLAINED já aplicados).
   */
  async applyResendStatus(
    resendId: string,
    status: 'SENT' | 'BOUNCED' | 'COMPLAINED',
  ): Promise<{ found: boolean; updated: boolean; previous?: EmailRowStatus }> {
    const current = await this.getByResendId(resendId);
    if (!current) return { found: false, updated: false };
    const terminal: EmailRowStatus[] = ['BOUNCED', 'COMPLAINED'];
    if (status === 'SENT' && (terminal.includes(current.status) || current.status === 'SENT')) {
      return { found: true, updated: false, previous: current.status };
    }
    if ((status === 'BOUNCED' || status === 'COMPLAINED') && current.status === status) {
      return { found: true, updated: false, previous: current.status };
    }
    await this.pool.query(
      `UPDATE email_messages SET status = $2, "updatedAt" = now() WHERE "resendId" = $1`,
      [resendId, status],
    );
    return { found: true, updated: true, previous: current.status };
  }
}
