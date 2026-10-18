import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { AUTH_POOL } from '../auth/auth-pool.provider';
import { EmailService } from './email.service';
import { handleEmailSendJob, type EmailSendJobRef } from './email-sender.worker';
import { dlqJobId } from './comm.queues';

/**
 * Relay de e-mails de auth: drena `auth.outbox_events` (claim SKIP LOCKED)
 * e envia o e-mail de verificação (e outros templates) via Resend de forma
 * idempotente. Roda dentro do processo da API (sem depender do workers stub).
 *
 * Idempotência em 3 camadas:
 *  - outbox: claim FOR UPDATE SKIP LOCKED + published=true só após processar;
 *  - handler: upsert eventId ON CONFLICT DO NOTHING;
 *  - Resend: Idempotency-Key = eventId.
 */
@Injectable()
export class AuthEmailRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AuthEmailRelayService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly apiKey: string;
  private readonly from: string;
  private readonly portalUrl: string;

  constructor(
    @Inject(AUTH_POOL) private readonly authPool: Pool,
    private readonly emailService: EmailService,
  ) {
    this.apiKey = process.env.RESEND_API_KEY ?? '';
    this.from = process.env.RESEND_FROM ?? 'no-reply@aurumbit.com.br';
    this.portalUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.PORTAL_URL ?? 'http://localhost:3002').replace(/\/+$/, '');
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((err) => this.log.error({ err }, 'auth-email-relay tick falhou'));
    }, 15_000);
    this.timer.unref?.();
    void this.tick().catch((err) => this.log.error({ err }, 'auth-email-relay tick inicial falhou'));
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<{ claimed: number; sent: number }> {
    if (!this.apiKey) {
      this.log.debug('RESEND_API_KEY ausente — relay em no-op');
      return { claimed: 0, sent: 0 };
    }
    const client = await this.authPool.connect();
    let claimed = 0;
    let sent = 0;
    let publishedIds: string[] = [];
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT "eventId", type, payload, "occurredAt"
           FROM outbox_events
          WHERE published = false
          ORDER BY "occurredAt" ASC
          LIMIT 50
          FOR UPDATE SKIP LOCKED`,
      );
      claimed = rows.length;
      for (const r of rows) {
        const eventId = String(r.eventId);
        const type = String(r.type);
        const payload = (r.payload ?? {}) as Record<string, unknown>;
        try {
          const job = await this.mapToJob(eventId, type, payload);
          if (!job) {
            publishedIds.push(eventId);
            continue;
          }
          const outcome = await handleEmailSendJob(
            { id: eventId, data: job, attemptsMade: 0 } as EmailSendJobRef,
            {
              store: this.emailService,
              transport: { send: (input) => this.sendViaResend(input) },
              moveToDlq: async (jobId, _data, reason) => {
                this.log.warn({ jobId, reason }, 'auth-email-relay → DLQ');
                void dlqJobId;
              },
              maxAttempts: 5,
            },
          );
          if (outcome.status === 'sent' || outcome.status === 'duplicate' || outcome.status === 'dlq') {
            publishedIds.push(eventId);
            if (outcome.status === 'sent') sent++;
          }
        } catch (err) {
          this.log.error({ eventId, err }, 'auth-email-relay: falha ao processar evento (retenta no próximo tick)');
        }
      }
      if (publishedIds.length > 0) {
        await client.query(`UPDATE outbox_events SET published = true WHERE "eventId" = ANY($1)`, [publishedIds]);
      }
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
      throw err;
    } finally {
      client.release();
    }
    if (claimed > 0) this.log.log(`auth-email-relay: claimed=${claimed} published=${publishedIds.length} sent=${sent}`);
    return { claimed, sent };
  }

  private async sendViaResend(input: { to: string; subject: string; html: string; text: string; idempotencyKey: string; tags?: Array<{ name: string; value: string }> }): Promise<{ resendId: string }> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Resend send falhou (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`);
      (err as { retryable?: boolean }).retryable = res.status === 429 || res.status >= 500;
      throw err;
    }
    const data = (await res.json()) as { id?: unknown };
    if (typeof data.id !== 'string' || data.id.length === 0) {
      const err = new Error('Resend respondeu 2xx sem id');
      (err as { retryable?: boolean }).retryable = true;
      throw err;
    }
    return { resendId: data.id };
  }

  private async mapToJob(eventId: string, type: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (type === 'auth.identity.created.v1' || type === 'auth.identity.created') {
      const identityId = String(payload.identityId ?? '');
      const verificationToken = String(payload.verificationToken ?? '');
      if (!identityId || !verificationToken) return null;
      const { rows } = await this.authPool.query(
        `SELECT "email_display" AS "emailDisplay" FROM user_identities WHERE id = $1`,
        [identityId],
      );
      const email = rows[0]?.emailDisplay as string | undefined;
      if (!email) return null;
      const actionUrl = `${this.portalUrl}/verificar-email?token=${encodeURIComponent(verificationToken)}`;
      return {
        eventId,
        to: email,
        template: 'verify-email',
        templateVersion: 'v1',
        vars: { actionUrl, expiresInMinutes: 1440 },
        correlationId: identityId,
      };
    }
    return null;
  }
}
