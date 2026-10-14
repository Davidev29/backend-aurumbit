import { randomUUID } from "node:crypto";
import { TOPICS, type Topic } from "./topics.js";

/**
 * Envelope de evento — Fase 1, sem negócio.
 * Alinhado a PROJECT §5 (idempotência) e REQUIREMENTS §4:
 * - `eventId` UNIQUE global → `UNIQUE(eventId)` em ProcessedEvent/Outbox,
 *   `jobId=eventId` no BullMQ, `idempotencyKey=eventId` no Resend.
 * - `version`/`occurredAt` permitem consumidor descartar evento antigo
 *   (nunca regredir estado terminal).
 * - Forward-compatible: produtores adicionam só campos opcionais em `payload`;
 *   consumidores ignoram desconhecidos e validam defensivamente.
 */

export interface EventEnvelope<T = unknown> {
  eventId: string;
  topic: Topic;
  version: number;
  occurredAt: string;
  correlationId?: string;
  causationId?: string;
  actor?: { id?: string; type?: string };
  payload: T;
}

export interface CreateEnvelopeInput<T = unknown> {
  topic: Topic;
  payload: T;
  version?: number;
  occurredAt?: string | Date;
  eventId?: string;
  correlationId?: string;
  causationId?: string;
  actor?: { id?: string; type?: string };
}

export function createEnvelope<T>(input: CreateEnvelopeInput<T>): EventEnvelope<T> {
  if (!TOPICS.includes(input.topic as (typeof TOPICS)[number])) {
    throw new Error(`Tópico desconhecido: ${String(input.topic)}`);
  }
  const occurredAt =
    input.occurredAt instanceof Date
      ? input.occurredAt.toISOString()
      : (input.occurredAt ?? new Date().toISOString());
  return {
    eventId: input.eventId ?? randomUUID(),
    topic: input.topic,
    version: input.version ?? 1,
    occurredAt,
    correlationId: input.correlationId,
    causationId: input.causationId,
    actor: input.actor,
    payload: input.payload ?? ({} as T),
  };
}

export function isEnvelope(v: unknown): v is EventEnvelope {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.eventId === "string" &&
    typeof o.topic === "string" &&
    typeof o.version === "number" &&
    typeof o.occurredAt === "string" &&
    "payload" in o
  );
}

/** Validação defensiva p/ consumidores idempotentes (retorna erros legíveis, nunca lança). */
export function parseEnvelope(v: unknown): { ok: true; envelope: EventEnvelope } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isEnvelope(v)) return { ok: false, errors: ["envelope inválido"] };
  if (!TOPICS.includes(v.topic as Topic)) errors.push(`topic desconhecido: ${v.topic}`);
  if (!Number.isInteger(v.version) || v.version < 1) errors.push("version deve ser inteiro >= 1");
  if (Number.isNaN(Date.parse(v.occurredAt))) errors.push("occurredAt deve ser ISO-8601");
  if (typeof v.eventId !== "string" || v.eventId.length < 8) errors.push("eventId inválido");
  return errors.length === 0 ? { ok: true, envelope: v } : { ok: false, errors };
}

/** Chave de idempotência derivada (BullMQ jobId / Resend / Outbox dedupe). */
export function idempotencyKeyOf(e: Pick<EventEnvelope, "eventId">): string {
  return e.eventId;
}
