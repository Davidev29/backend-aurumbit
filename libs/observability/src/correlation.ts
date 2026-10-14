import { randomUUID } from "node:crypto";
import { CORRELATION_HEADER } from "./logger.js";

/**
 * Propagação de `correlationId` — Fase 6 (aditivo, sem negócio).
 *
 * Fluxo verificado (1 fluxo ponta-a-ponta, ver docs/RUNBOOKS/correlation.md):
 *
 * ```
 * HTTP (x-correlation-id)
 *   → Outbox (`email_messages.correlationId` / envelope.correlationId)
 *   → BullMQ job (`job.data.correlationId`, `jobId = eventId`)
 *   → Resend (`idempotencyKey = eventId`, tag/header de correlação)
 *   → Audit (`metadata.correlationId` — allowlist em audit-record.ts)
 * ```
 *
 * Regras (PROJECT §5 + REQUIREMENTS §4):
 * - `eventId` é a chave de idempotência; `correlationId` é SÓ correlação
 *   (nunca dedupe por ele).
 * - Ausente → gera (`randomUUID`); nunca `throw`, nunca vazio.
 * - `withSpan` futuro anexa `correlationId` como atributo de span.
 */

export interface CorrelationCarrier {
  correlationId?: string | null;
}

/** Extrai de headers HTTP (case-insensitive) ou gera um novo. */
export function correlationIdFromCarrier(
  headers: Record<string, string | string[] | undefined>,
): string {
  const pick = (k: string): string | undefined => {
    const raw = headers[k] ?? headers[k.toLowerCase()] ?? headers[k.toUpperCase()];
    const first = Array.isArray(raw) ? raw[0] : raw;
    return first && first.trim() !== "" ? first : undefined;
  };
  return pick(CORRELATION_HEADER) ?? pick("X-Correlation-Id") ?? randomUUID();
}

/** Copia a correlação de um envelope/evento para o próximo estágio (puro). */
export function propagateCorrelation<T extends CorrelationCarrier>(
  from: CorrelationCarrier | undefined,
  to: T,
  fallbackHeaders?: Record<string, string | string[] | undefined>,
): T & { correlationId: string } {
  const id =
    (typeof from?.correlationId === "string" && from.correlationId.trim() !== ""
      ? from.correlationId
      : undefined) ??
    (fallbackHeaders ? correlationIdFromCarrier(fallbackHeaders) : randomUUID());
  return { ...to, correlationId: id };
}

/** Monta o job BullMQ preservando `correlationId` (`jobId = eventId`). */
export function toBullMqJob<T extends { eventId: string } & CorrelationCarrier>(
  envelope: T,
): { jobId: string; data: T } {
  return { jobId: envelope.eventId, data: { ...envelope } };
}

/** Chave de idempotência do Resend: SEMPRE o `eventId` (nunca o correlationId). */
export function resendIdempotencyKeyOf(e: { eventId: string }): string {
  return e.eventId;
}

/** Tags Resend que carregam a correlação (visíveis nos webhooks de entrega). */
export function resendTagsWithCorrelation(
  correlationId: string | undefined,
): Array<{ name: string; value: string }> {
  if (!correlationId || correlationId.trim() === "") return [];
  return [{ name: "correlationId", value: correlationId }];
}

/** Fragmento de metadata p/ Audit (`audit-record.ts` precisa permitir a chave). */
export function auditMetadataWithCorrelation(
  metadata: Record<string, unknown> | undefined,
  correlationId: string | undefined,
): Record<string, unknown> {
  if (!correlationId || correlationId.trim() === "") return { ...(metadata ?? {}) };
  return { ...(metadata ?? {}), correlationId };
}
