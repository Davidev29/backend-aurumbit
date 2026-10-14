import { trace, context, type Tracer, type Span } from "@opentelemetry/api";
import { getLogger } from "./logger.js";

/**
 * Tracing OTel — STUB Fase 1 (sem negócio, sem exporter).
 * - API estável para T2/T4 plugarem (`initTracing`, `withSpan`).
 * - Se `OTEL_EXPORTER_OTLP_ENDPOINT` estiver ausente, opera em no-op
 *   (usa o tracer noop global) e loga 1x em boot. Nada quebra.
 * - CorrelationId (PROJECT §4/REQUIREMENTS §4) continua via header
 *   `x-correlation-id`; spans futuros o anexam como atributo.
 */

let warnedNoop = false;

export function initTracing(serviceName = process.env.SERVICE_NAME ?? "api"): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint && !warnedNoop) {
    warnedNoop = true;
    // Fase 6: warn (antes info) — runbook health/SLOs orienta configurar o
    // endpoint em prod; sem ele o tracer noop global é usado e nada quebra.
    getLogger().warn(
      { serviceName },
      "tracing em modo no-op (OTEL_EXPORTER_OTLP_ENDPOINT ausente) — stub Fase 6, sem exporter",
    );
    return;
  }
  if (endpoint && !warnedNoop) {
    warnedNoop = true;
    // Wiring real (NodeSDK + OTLP) é plugado aqui quando as deps
    // `@opentelemetry/sdk-node` + `@opentelemetry/exporter-trace-otlp-http`
    // forem adicionadas — ver docs/SLOs.md § Tracing. Sem elas, segue no-op
    // com o tracer global (contrato estável p/ chamadores de `withSpan`).
    getLogger().info({ serviceName, endpoint }, "tracing OTel: endpoint configurado (exporter pluga na Fase 6+)");
  }
  // Fase 6 pluga NodeSDK + OTLP exporter aqui sem mudar chamadores.
}

export function getTracer(name = "aurum-bit"): Tracer {
  return trace.getTracer(name);
}

export async function withSpan<T>(
  spanName: string,
  fn: (span: Span) => Promise<T> | T,
  attrs: Record<string, string | number | boolean> = {},
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(spanName, async (span) => {
    try {
      for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
      return await fn(span);
    } finally {
      span.end();
    }
  });
}

/** Propaga contexto W3C atual (stub: retorna headers vazios em no-op). */
export function injectTraceHeaders(
  carrier: Record<string, string> = {},
): Record<string, string> {
  // Quando o SDK real for plugado, usar propagation.inject(context.active(), carrier).
  void context.active();
  return carrier;
}
