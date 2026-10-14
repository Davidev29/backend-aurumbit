import pino, { type Logger as PinoLogger, type LoggerOptions } from "pino";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Logger base Aurum Bit — Fase 1, sem negócio.
 * - JSON em produção, pretty só local (pino-pretty opcional, nunca em prod).
 * - `x-correlation-id` propagado via AsyncLocalStorage (ver tracing.ts).
 * - Redação automática de campos sensíveis (LGPD §4 / PROJECT §2: nunca logar chave).
 */

const store = new AsyncLocalStorage<{ correlationId: string }>();

export const CORRELATION_HEADER = "x-correlation-id";

export function getCorrelationId(): string | undefined {
  return store.getStore()?.correlationId;
}

/** Executa `fn` com um correlationId fixo no contexto (middleware/interceptor usa este). */
export function runWithCorrelationId<T>(id: string | undefined, fn: () => T): T {
  return store.run({ correlationId: id ?? randomUUID() }, fn);
}

/** Extrai ou gera correlationId a partir dos headers de entrada. */
export function correlationIdFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): string {
  const raw = headers[CORRELATION_HEADER] ?? headers["X-Correlation-Id"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first && first.trim() !== "" ? first : randomUUID();
}

const redactPaths = [
  "password",
  "currentPassword",
  "newPassword",
  "authorization",
  "cookie",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "licenseKey",
  "key",
  "key_enc",
  "cpf",
  "cnpj",
  "*.password",
  "*.token",
  "req.headers.authorization",
  "req.headers.cookie",
];

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: redactPaths, censor: "[REDACTED]" },
  base: {
    service: process.env.SERVICE_NAME ?? "api",
    env: process.env.NODE_ENV ?? "development",
  },
};

const rootLogger: PinoLogger = pino(baseOptions);

/** Logger com correlationId anexado quando houver contexto. */
export function getLogger(bindings: Record<string, unknown> = {}): PinoLogger {
  const correlationId = getCorrelationId();
  if (correlationId) return rootLogger.child({ correlationId, ...bindings });
  return rootLogger.child(bindings);
}

export const logger: PinoLogger = rootLogger;
export type Logger = PinoLogger;
