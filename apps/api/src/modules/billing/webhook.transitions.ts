/**
 * Transições + parsing do webhook Asaas (Fase 4, PROJECT.md §5).
 * Puro (sem Nest/PG): testável em unit.
 * - `RECEIVED → VALIDATED → APPLIED | REJECTED | DUPLICATE`.
 * - `ON CONFLICT(provider, externalId) DO NOTHING` → 200 duplicate.
 * - `assertWebhookTransition(from,to)`; ilegal → REJECTED + alerta, sem
 *   sobrescrever (espelha `assertTransition` do billing core para
 *   pagamentos; aqui só o fluxo do receipt, sem reescrever o core).
 */

import { timingSafeEqual } from 'node:crypto';

/** Header que o Asaas envia com o segredo (`ASAAS_WEBHOOK_SECRET`). */
export const WEBHOOK_TOKEN_HEADER = 'asaas-access-token';
export const WEBHOOK_PROVIDER = 'ASAAS';

export type WebhookReceiptStatus = 'RECEIVED' | 'VALIDATED' | 'APPLIED' | 'REJECTED' | 'DUPLICATE';

const WEBHOOK_ALLOWED: Record<WebhookReceiptStatus, WebhookReceiptStatus[]> = {
  RECEIVED: ['VALIDATED', 'DUPLICATE', 'REJECTED'],
  VALIDATED: ['APPLIED', 'REJECTED', 'DUPLICATE'],
  APPLIED: [],
  REJECTED: [],
  DUPLICATE: [],
};

export class IllegalWebhookTransition extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
    readonly allowed: string[],
  ) {
    super(
      `transição webhook ${from} → ${to} ilegal (permitidas: ${allowed.join(', ') || 'nenhuma'})`,
    );
    this.name = 'IllegalWebhookTransition';
  }
}

/** Ilegal → lança (chamador marca REJECTED + alerta, sem sobrescrever). */
export function assertWebhookTransition(from: string, to: string): void {
  const allowed = WEBHOOK_ALLOWED[from as WebhookReceiptStatus];
  if (!allowed) throw new IllegalWebhookTransition(from, to, []);
  if (!allowed.includes(to as WebhookReceiptStatus)) {
    throw new IllegalWebhookTransition(from, to, allowed);
  }
}

export function isWebhookTerminal(status: string): boolean {
  return status === 'APPLIED' || status === 'REJECTED' || status === 'DUPLICATE';
}

// --- autenticação do webhook -----------------------------------------------

/** Timing-safe; nunca lança em length mismatch (retorna false). */
export function timingSafeTokenEqual(received: string, expected: string): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Fail-closed: segredo ausente/inválido → false (controller vira 401). */
export function validateWebhookToken(
  tokenHeader: string | undefined,
  expected: string | null,
): boolean {
  if (!tokenHeader || !expected) return false;
  return timingSafeTokenEqual(tokenHeader, expected);
}

// --- IP allowlist (TODO oficial) ---------------------------------------------
// TODO(produção): fixar ranges oficiais do Asaas em `ASAAS_IP_ALLOWLIST`
// (CSV) e negar por default. Hoje: lista vazia = permite com warn
// (Sandbox; sem bloquear entregas antes dos ranges conhecidos).

export function parseIpAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isIpAllowed(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  return allowlist.includes(ip);
}

/** `X-Forwarded-For` (primeiro) → `req.ip` → socket. */
export function extractClientIp(req: {
  headers?: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length > 0) return String(fwd[0]).split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

// --- parsing do payload Asaas -------------------------------------------------

export interface ParsedAsaasWebhook {
  /** Ex.: `PAYMENT_CONFIRMED`. */
  event: string;
  /** `id` do payment/subscription no Asaas. */
  paymentId: string;
  /** Chave de dedupe `UNIQUE(provider, externalId)`: redelivery → duplicate. */
  externalId: string;
  /** `jobId` BullMQ (`jobId = eventId`, PROJECT.md §5). */
  eventId: string;
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function nestedId(body: Record<string, unknown>): string | null {
  for (const key of ['payment', 'object', 'data', 'subscription']) {
    const node = body[key];
    if (typeof node === 'object' && node !== null) {
      const id = asStr((node as Record<string, unknown>).id);
      if (id) return id;
    }
  }
  return asStr(body.id);
}

/**
 * Extrai `(event, paymentId)` dos formatos do Asaas
 * (`{ event, payment: { id } }`, `{ eventType, object: { id } }`, ...).
 * Retorna `null` quando sem identidade (controller → 400, sem persistir).
 */
export function parseAsaasWebhook(
  body: unknown,
): Omit<ParsedAsaasWebhook, 'externalId' | 'eventId'> | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const event = asStr(b.event) ?? asStr(b.eventType);
  const paymentId = nestedId(b);
  if (!event || !paymentId) return null;
  return { event, paymentId };
}

/** Dedupe por (evento, objeto): redelivery do mesmo fato → duplicate. */
export function buildWebhookExternalId(event: string, paymentId: string): string {
  return `${event}:${paymentId}`;
}

/** `jobId` BullMQ = `eventId` (PROJECT.md §5). */
export function buildWebhookEventId(externalId: string): string {
  return `wh:asaas:${externalId}`;
}

export function parseAsaasEnvelope(body: unknown): ParsedAsaasWebhook | null {
  const parsed = parseAsaasWebhook(body);
  if (!parsed) return null;
  const externalId = buildWebhookExternalId(parsed.event, parsed.paymentId);
  return { ...parsed, externalId, eventId: buildWebhookEventId(externalId) };
}
