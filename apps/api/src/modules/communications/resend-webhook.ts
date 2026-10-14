import { createHmac, timingSafeEqual } from 'node:crypto';

// Webhook Resend — verificação Svix + parse defensivo (Fase 4).
// Espelha `libs/resend-adapter` (cópia local: apps/api compila com rootDir
// próprio e não importa os pacotes — mesmo padrão de licensing).
// Divergência intencional: nenhuma — manter 1:1 com o adapter.

export const RESEND_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export type ResendDeliveryStatus = 'BOUNCED' | 'COMPLAINED' | 'DELIVERED';

export interface ParsedResendWebhook {
  webhookId: string;
  type: string;
  emailId?: string;
  delivery: ResendDeliveryStatus | null;
}

export function resolveDeliveryStatus(type: string): ResendDeliveryStatus | null {
  switch (type) {
    case 'email.bounced':
    case 'email.delivery_delayed':
      return 'BOUNCED';
    case 'email.complained':
      return 'COMPLAINED';
    case 'email.delivered':
      return 'DELIVERED';
    default:
      return null;
  }
}

export function parseResendWebhook(body: unknown):
  | { ok: true; event: ParsedResendWebhook }
  | { ok: false; errors: string[] } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, errors: ['corpo do webhook inválido'] };
  }
  const o = body as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof o.type !== 'string' || o.type.length === 0) errors.push('type ausente');
  const data = o.data as Record<string, unknown> | undefined;
  const emailId =
    data !== null && typeof data === 'object' ? (data as Record<string, unknown>).email_id : undefined;
  const webhookId =
    (typeof o.id === 'string' && o.id.length > 0 ? o.id : undefined) ??
    (typeof o.event_id === 'string' && o.event_id.length > 0 ? o.event_id : undefined) ??
    (data !== null &&
    typeof data === 'object' &&
    typeof (data as Record<string, unknown>).webhook_id === 'string'
      ? ((data as Record<string, unknown>).webhook_id as string)
      : undefined);
  if (!webhookId) errors.push('id do evento ausente (id/event_id/data.webhook_id)');
  if (errors.length > 0) return { ok: false, errors };
  const type = o.type as string;
  return {
    ok: true,
    event: {
      webhookId: webhookId as string,
      type,
      emailId: typeof emailId === 'string' ? emailId : undefined,
      delivery: resolveDeliveryStatus(type),
    },
  };
}

function secretKey(secret: string): Buffer {
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  return Buffer.from(raw, 'base64');
}

function headerOf(headers: Record<string, string | undefined>, name: string): string | undefined {
  const direct = headers[name];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const found = Object.entries(headers).find(([k]) => k.toLowerCase() === name);
  return typeof found?.[1] === 'string' && (found[1] as string).length > 0
    ? (found[1] as string)
    : undefined;
}

/**
 * Verifica a assinatura Svix sobre os bytes crus do corpo.
 * `payload` DEVE ser o corpo cru (`req.rawBody`); quando o runtime não o
 * preserva, o controller usa `JSON.stringify(body)` como melhor esforço e
 * documenta a limitação (produção: preservar bytes crus).
 */
export function verifyResendWebhookSignature(opts: {
  secret: string;
  payload: string;
  headers: Record<string, string | undefined>;
  nowMs?: number;
}): boolean {
  const { secret, payload, headers } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const id = headerOf(headers, 'svix-id');
  const sig = headerOf(headers, 'svix-signature');
  const ts = headerOf(headers, 'svix-timestamp');
  if (!secret || !id || !sig || !ts) return false;
  const tsMs = Number(ts) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(nowMs - tsMs) > RESEND_WEBHOOK_TOLERANCE_MS) return false;
  let key: Buffer;
  try {
    key = secretKey(secret);
  } catch {
    return false;
  }
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${payload}`, 'utf8').digest();
  for (const part of sig.split(' ')) {
    const comma = part.indexOf(',');
    if (comma < 0) continue;
    if (part.slice(0, comma) !== 'v1') continue;
    const candidate = Buffer.from(part.slice(comma + 1), 'base64');
    if (candidate.length !== expected.length) continue;
    if (timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

/** Assina (Svix) — exposto p/ testes/docs. */
export function signResendWebhookPayload(secret: string, id: string, timestamp: string, payload: string): string {
  const signed = `${id}.${timestamp}.${payload}`;
  return `v1,${createHmac('sha256', secretKey(secret)).update(signed, 'utf8').digest('base64')}`;
}
