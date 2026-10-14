import { z } from 'zod';
import { SEND_MAX_ATTEMPTS, dlqJobId } from './comm.queues';
import type { EmailRowStatus } from './email.service';
import { renderTemplate } from './email-templates';

// EmailSenderWorker — handler puro da fila `comm.email.send` (Fase 4).
// - `jobId = eventId` na produção (ver comm.queues `sendJobOptions`).
// - Idempotência em 2 camadas: upsert `eventId ON CONFLICT DO NOTHING`
//   (replay retorna `duplicate` SEM reenviar) + `idempotencyKey=eventId`
//   no Resend (protege crash entre send e markSent).
// - Payload/vars inválidos ou template desconhecido → DLQ direto (poison;
//   retry não ajuda). Falha transitória → throw p/ retry exponencial;
//   esgotados os attempts → FAILED + DLQ preservando o eventId.
// - Testável sem Redis/PG: store + transport + DLQ injetados via `deps`.

export const SendJobSchema = z
  .object({
    eventId: z.string().min(8),
    to: z.string().min(3),
    template: z.string().min(1),
    templateVersion: z.string().min(1).default('v1'),
    vars: z.record(z.unknown()).default({}),
    correlationId: z.string().optional(),
  })
  .passthrough();

export type SendJobData = z.infer<typeof SendJobSchema>;

export interface EmailSendJobRef {
  id?: string;
  data: unknown;
  attemptsMade: number;
}

export interface EmailSenderStore {
  requestEmail(input: {
    eventId: string;
    correlationId?: string;
    to: string;
    template: string;
    templateVersion?: string;
    vars: Record<string, unknown>;
  }): Promise<{ inserted: boolean; status: EmailRowStatus }>;
  markSending(eventId: string): Promise<boolean>;
  markSent(eventId: string, resendId: string): Promise<void>;
  markFailed(eventId: string, error: string): Promise<void>;
}

export interface EmailTransport {
  send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
    /** Fase 6 (opcional): tags do Resend — leva `correlationId` (ver helper abaixo). */
    tags?: Array<{ name: string; value: string }>;
  }): Promise<{ resendId: string }>;
}

export interface EmailSenderDeps {
  maxAttempts?: number;
  store: EmailSenderStore;
  transport: EmailTransport;
  moveToDlq: (jobId: string, data: SendJobData, reason: string) => Promise<void>;
}

export type EmailSendOutcome =
  | { status: 'sent'; eventId: string; resendId: string }
  | { status: 'duplicate'; eventId: string }
  | { status: 'dlq'; eventId: string };

const TERMINAL_NO_RESEND: EmailRowStatus[] = ['SENT', 'BOUNCED', 'COMPLAINED'];

export async function handleEmailSendJob(job: EmailSendJobRef, deps: EmailSenderDeps): Promise<EmailSendOutcome> {
  const parsed = SendJobSchema.safeParse(job.data);
  if (!parsed.success) {
    const reason = `send job inválido: ${parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')}`;
    const fallback = fallbackData(job);
    await deps.moveToDlq(dlqJobId(fallback.eventId), fallback, reason);
    return { status: 'dlq', eventId: fallback.eventId };
  }
  const data = parsed.data;

  // Render primeiro (poison rápido, antes de tocar o DB): template
  // desconhecido/fora de escopo/versão/var ausente → DLQ direto.
  let rendered: { subject: string; html: string; text: string };
  try {
    rendered = renderTemplate(data.template, data.templateVersion, data.vars as Record<string, unknown>);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await deps.moveToDlq(dlqJobId(data.eventId), data, `template: ${reason}`);
    return { status: 'dlq', eventId: data.eventId };
  }

  // Upsert idempotente. Conflito + status terminal que dispensa envio
  // (SENT/BOUNCED/COMPLAINED) → replay: NÃO reenvia.
  let upsert: { inserted: boolean; status: EmailRowStatus };
  try {
    upsert = await deps.store.requestEmail({
      eventId: data.eventId,
      correlationId: data.correlationId,
      to: data.to,
      template: data.template,
      templateVersion: data.templateVersion,
      vars: data.vars as Record<string, unknown>,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await deps.moveToDlq(dlqJobId(data.eventId), data, `upsert: ${reason}`);
    return { status: 'dlq', eventId: data.eventId };
  }
  if (!upsert.inserted && TERMINAL_NO_RESEND.includes(upsert.status)) {
    return { status: 'duplicate', eventId: data.eventId };
  }

  // Marca SENDING (melhor esforço: se outro worker já avançou, o upsert
  // acima + idempotencyKey do Resend mantêm a garantia).
  try {
    await deps.store.markSending(data.eventId);
  } catch {
    /* segue p/ o envio; o status será reconciliado no markSent/markFailed */
  }

  try {
    const { resendId } = await deps.transport.send({
      to: data.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: data.eventId,
      // Fase 6: correlationId viaja como tag Resend (visível nos webhooks);
      // idempotência continua sendo SÓ o eventId.
      ...(typeof data.correlationId === 'string' && data.correlationId.length > 0
        ? { tags: [{ name: 'correlationId', value: data.correlationId }] }
        : {}),
    });
    await deps.store.markSent(data.eventId, resendId);
    return { status: 'sent', eventId: data.eventId, resendId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryable = (err as { retryable?: boolean }).retryable !== false;
    const max = deps.maxAttempts ?? SEND_MAX_ATTEMPTS;
    if (retryable && job.attemptsMade + 1 < max) throw err; // BullMQ reagenda (backoff exp)
    try {
      await deps.store.markFailed(data.eventId, message);
    } catch {
      /* DLQ registra a causa mesmo se o mark falhar */
    }
    await deps.moveToDlq(dlqJobId(data.eventId), data, message);
    return { status: 'dlq', eventId: data.eventId };
  }
}

function fallbackData(job: EmailSendJobRef): SendJobData {
  return {
    eventId: typeof job.id === 'string' && job.id.length >= 8 ? job.id : 'job-sem-eventid',
    to: 'invalid',
    template: 'unknown',
    templateVersion: 'v1',
    vars: { original: job.data },
  };
}
