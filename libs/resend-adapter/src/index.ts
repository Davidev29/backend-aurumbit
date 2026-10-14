import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Adapter Resend — Fase 4 (PROJECT.md §§5-6, REQUIREMENTS.md §4).
 * Sem dependências externas (só `node:crypto` + `fetch` global do Node 20+).
 *
 * Convenções:
 * - `idempotencyKey = eventId` em todo envio (header `Idempotency-Key`);
 *   replay do mesmo evento nunca duplica no provedor.
 * - Erros 429/5xx → `retryable: true` (worker reagenda, backoff exponencial);
 *   4xx → `retryable: false` (poison → DLQ direto).
 * - Webhook: assinatura Svix (`svix-id/svix-signature/svix-timestamp`) sobre
 *   os bytes crus do corpo; `parseResendWebhook` valida defensivamente.
 */

export const RESEND_API_BASE_URL = "https://api.resend.com";
/** Tolerância do timestamp Svix (5min, mesmo padrão do Asaas). */
export const RESEND_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export interface ResendSendInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Remetente padrão (`RESEND_FROM`); sobrescrito por chamada quando preciso. */
  from?: string;
  replyTo?: string;
  /** OBRIGATÓRIO — sempre o `eventId` do envelope (PROJECT.md §5). */
  idempotencyKey: string;
  tags?: Array<{ name: string; value: string }>;
}

export interface ResendSendResult {
  resendId: string;
}

export class ResendError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  constructor(message: string, opts: { retryable: boolean; status?: number }) {
    super(message);
    this.name = "ResendError";
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}

/** Subconjunto de `fetch` usado pelo cliente (injetável em teste). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface ResendClientOptions {
  apiKey: string;
  from: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

const defaultFetch: FetchLike = (url, init) =>
  fetch(url, init) as unknown as ReturnType<FetchLike>;

export class ResendClient {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: ResendClientOptions) {
    if (!opts.apiKey) throw new Error("ResendClient: apiKey ausente (RESEND_API_KEY).");
    if (!opts.from) throw new Error("ResendClient: from ausente (RESEND_FROM).");
    this.apiKey = opts.apiKey;
    this.from = opts.from;
    this.baseUrl = (opts.baseUrl ?? RESEND_API_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  async send(input: ResendSendInput): Promise<ResendSendResult> {
    if (!input.to || !input.to.includes("@")) {
      throw new ResendError("destinatário inválido", { retryable: false });
    }
    if (!input.subject) throw new ResendError("subject ausente", { retryable: false });
    if (!input.html) throw new ResendError("html ausente", { retryable: false });
    if (!input.idempotencyKey || input.idempotencyKey.length < 8) {
      throw new ResendError("idempotencyKey inválido (use o eventId)", { retryable: false });
    }
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          from: input.from ?? this.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          ...(input.text ? { text: input.text } : {}),
          ...(input.replyTo ? { reply_to: input.replyTo } : {}),
          ...(input.tags ? { tags: input.tags } : {}),
        }),
      });
    } catch (err) {
      throw new ResendError(`falha de rede no Resend: ${(err as Error).message}`, {
        retryable: true,
      });
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        detail = "";
      }
      throw new ResendError(`Resend send falhou (HTTP ${res.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`, {
        retryable,
        status: res.status,
      });
    }
    const data = (await res.json()) as { id?: unknown };
    if (typeof data.id !== "string" || data.id.length === 0) {
      throw new ResendError("Resend respondeu 2xx sem id", { retryable: true });
    }
    return { resendId: data.id };
  }
}

// ---------------------------------------------------------------------------
// Webhook (eventos de entrega/engajamento)
// ---------------------------------------------------------------------------

/** Status de entrega derivado do tipo do evento Resend. */
export type ResendDeliveryStatus = "BOUNCED" | "COMPLAINED" | "DELIVERED";

export interface ParsedResendWebhook {
  /** Id do evento no Resend (dedupe: `WebhookReceipt.externalId`). */
  webhookId: string;
  type: string;
  /** `data.email_id` — alvo em `EmailMessage.resendId`. */
  emailId?: string;
  delivery: ResendDeliveryStatus | null;
}

/**
 * Validação defensiva do corpo do webhook (nunca lança; desconhecidos → `ok:false`).
 * Formato Resend: `{ type: "email.bounced", data: { email_id, ... }, id? }`
 * (o id do evento pode vir em `id` ou em `data.webhook_id` conforme versão).
 */
export function parseResendWebhook(body: unknown):
  | { ok: true; event: ParsedResendWebhook }
  | { ok: false; errors: string[] } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, errors: ["corpo do webhook inválido"] };
  }
  const o = body as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof o.type !== "string" || o.type.length === 0) errors.push("type ausente");
  const data = o.data as Record<string, unknown> | undefined;
  const emailId = data !== null && typeof data === "object" ? (data as Record<string, unknown>).email_id : undefined;
  const webhookId =
    (typeof o.id === "string" && o.id.length > 0 ? o.id : undefined) ??
    (typeof o.event_id === "string" && o.event_id.length > 0 ? o.event_id : undefined) ??
    (data !== null && typeof data === "object" && typeof (data as Record<string, unknown>).webhook_id === "string"
      ? ((data as Record<string, unknown>).webhook_id as string)
      : undefined);
  if (!webhookId) errors.push("id do evento ausente (id/event_id/data.webhook_id)");
  if (errors.length > 0) return { ok: false, errors };
  const type = o.type as string;
  return {
    ok: true,
    event: {
      webhookId: webhookId as string,
      type,
      emailId: typeof emailId === "string" ? emailId : undefined,
      delivery: resolveDeliveryStatus(type),
    },
  };
}

/** Mapeia o tipo Resend → efeito no `EmailMessage.status` (`null` = só ack 200). */
export function resolveDeliveryStatus(type: string): ResendDeliveryStatus | null {
  switch (type) {
    case "email.bounced":
    case "email.delivery_delayed":
      return "BOUNCED";
    case "email.complained":
      return "COMPLAINED";
    case "email.delivered":
      return "DELIVERED";
    default:
      return null; // opened/clicked/sent/etc: sem efeito em status
  }
}

// ---------------------------------------------------------------------------
// Assinatura Svix
// ---------------------------------------------------------------------------

export interface SvixHeaders {
  "svix-id"?: string;
  "svix-signature"?: string;
  "svix-timestamp"?: string;
  [k: string]: string | undefined;
}

function headerOf(headers: SvixHeaders, name: string): string | undefined {
  const direct = headers[name];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const lower = Object.entries(headers).find(([k]) => k.toLowerCase() === name);
  return typeof lower?.[1] === "string" && (lower[1] as string).length > 0
    ? (lower[1] as string)
    : undefined;
}

/** Assina (Svix) — exposto p/ testes/docs; o Resend assina do lado dele. */
export function signResendWebhookPayload(secret: string, id: string, timestamp: string, payload: string): string {
  const key = secretKey(secret);
  const signed = `${id}.${timestamp}.${payload}`;
  return `v1,${createHmac("sha256", key).update(signed, "utf8").digest("base64")}`;
}

function secretKey(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(raw, "base64");
}

/**
 * Verifica a assinatura Svix sobre os BYTES CRUS do corpo (`rawBody`).
 * Em produção o controller deve preservar os bytes crus; sem eles a
 * verificação não é confiável (ver comentário no controller).
 */
export function verifyResendWebhookSignature(opts: {
  secret: string;
  payload: string;
  headers: SvixHeaders;
  nowMs?: number;
}): boolean {
  const { secret, payload, headers } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const id = headerOf(headers, "svix-id");
  const sig = headerOf(headers, "svix-signature");
  const ts = headerOf(headers, "svix-timestamp");
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
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${payload}`, "utf8").digest();
  for (const part of sig.split(" ")) {
    const comma = part.indexOf(",");
    if (comma < 0) continue;
    if (part.slice(0, comma) !== "v1") continue;
    const candidate = Buffer.from(part.slice(comma + 1), "base64");
    if (candidate.length !== expected.length) continue;
    if (timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Privacidade (espelha libs/security; adapter sem dependências internas)
// ---------------------------------------------------------------------------

/** SHA-256 hex — `recipientHash` (busca), nunca p/ senha. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Normaliza e-mail p/ hash/busca (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `d***@dominio` p/ suporte/logs (espelha libs/security `maskEmail`). */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const user = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (user.length <= 1) return `*@${domain}`;
  return `${user[0]}***@${domain}`;
}

const SECRET_VAR_PATTERNS = ["token", "secret", "password", "code", "otp", "pin", "key_enc", "licensekey"];

/**
 * Redige vars de template antes de persistir (`EmailMessage.variables`):
 * segredos (code/token/...) viram `[REDACTED]` — o render usa as vars
 * completas do job em memória, nunca as persistidas.
 */
export function redactEmailVars(vars: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) {
    const low = k.toLowerCase();
    out[k] = SECRET_VAR_PATTERNS.some((p) => low.includes(p)) ? "[REDACTED]" : v;
  }
  return out;
}
