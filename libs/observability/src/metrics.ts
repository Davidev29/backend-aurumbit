import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

/**
 * Métricas base — Fase 1, sem negócio.
 * O CI valida que `/metrics` expõe `http_requests_total`.
 * Domínios futuros (billing.recon.*, license.check.*) reutilizam este registry.
 */

export const registry = new Registry();
registry.setDefaultLabels({
  service: process.env.SERVICE_NAME ?? "api",
  env: process.env.NODE_ENV ?? "development",
});

collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total de requisições HTTP por rota/método/status.",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duração das requisições HTTP em segundos.",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const buildInfo = new Gauge({
  name: "app_build_info",
  help: "Info estática de build (version/sha).",
  labelNames: ["version", "sha"] as const,
  registers: [registry],
});
buildInfo.set(
  { version: process.env.APP_VERSION ?? "0.0.0-fase1", sha: process.env.GIT_SHA ?? "unknown" },
  1,
);

/** Stubs forward-compatible p/ fases futuras (registrados já p/ dashboard não quebrar). */
export const licenseCheckTotal = new Counter({
  name: "license_check_total",
  help: "Stub Fase 1: checagens de licença por resultado (Fase 3).",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const billingReconTotal = new Counter({
  name: "billing_recon_total",
  help: "Stub Fase 1: reconciliações Asaas por resultado (Fase 4, PROJECT §5).",
  labelNames: ["result"] as const,
  registers: [registry],
});

export async function metricsBody(): Promise<string> {
  return registry.metrics();
}

export function metricsContentType(): string {
  return registry.contentType;
}

/* ------------------------------------------------------------------ */
/* Fase 6 — Obs + SLOs (aditivo; nenhum contrato Fase 1 muda).         */
/* Nomes Prometheus usam `_` (ex. `billing_recon_total` cobre o lógico */
/* `billing.recon.*` do PROJECT §5). Todos registrados já em boot p/   */
/* dashboards Grafana não quebrarem antes do primeiro incremento.     */
/* ------------------------------------------------------------------ */

/** Lag da outbox por tópico (segundos desde `occurredAt` do +antigo não-publicado). */
export const outboxLagSeconds = new Gauge({
  name: "outbox_lag_seconds",
  help: "Fase 6: lag da outbox em segundos por tópico (0 = drenada).",
  labelNames: ["topic"] as const,
  registers: [registry],
});

/** Profundidade da DLQ por fila BullMQ (alerta quando > 0). */
export const bullmqDlqDepth = new Gauge({
  name: "bullmq_dlq_depth",
  help: "Fase 6: mensagens na DLQ por fila BullMQ.",
  labelNames: ["queue"] as const,
  registers: [registry],
});

/** Reconciliação billing extra (granular) — soma-se ao `billing_recon_total` Fase 1. */
export const billingWebhookTotal = new Counter({
  name: "billing_webhook_total",
  help: "Fase 6: webhooks Asaas por resultado (received/applied/duplicate/rejected).",
  labelNames: ["result"] as const,
  registers: [registry],
});

/** Projeções finance (`finance.projection.*`, Fase 5 → exposto Fase 6). */
export const financeProjectionTotal = new Counter({
  name: "finance_projection_total",
  help: "Fase 6: projeções financeiras por resultado (hit/miss/computed/failed/invalidated).",
  labelNames: ["result"] as const,
  registers: [registry],
});

/** Retenção/purge (`retention.*`, LGPD.md + PROJECT §4). */
export const retentionRunsTotal = new Counter({
  name: "retention_runs_total",
  help: "Fase 6: execuções de jobs de retenção por job/resultado.",
  labelNames: ["job", "result"] as const,
  registers: [registry],
});

export const retentionPurgedTotal = new Counter({
  name: "retention_purged_total",
  help: "Fase 6: linhas purgadas por job de retenção.",
  labelNames: ["job"] as const,
  registers: [registry],
});

/** E-mails (dashboard Email). Espelha `email_send` do domínio communications. */
export const emailSendTotal = new Counter({
  name: "email_send_total",
  help: "Fase 6: envios de e-mail por template/resultado (sent/duplicate/dlq).",
  labelNames: ["template", "result"] as const,
  registers: [registry],
});

/** Auditoria (dashboard Audit). Espelha `AuditService.emit`. */
export const auditEventsTotal = new Counter({
  name: "audit_events_total",
  help: "Fase 6: eventos de auditoria emitidos por ação.",
  labelNames: ["action"] as const,
  registers: [registry],
});

/* Helpers idempotentes p/ API/workers espelharem contadores in-memory no Prometheus. */

export function observeHttpRequest(
  method: string,
  route: string,
  status: number | string,
  seconds: number,
): void {
  const labels = { method, route, status: String(status) } as const;
  httpRequestsTotal.inc(labels as unknown as Record<string, string>);
  httpRequestDurationSeconds.observe(labels as unknown as Record<string, string>, seconds);
}

export function setOutboxLag(topic: string, seconds: number): void {
  outboxLagSeconds.set({ topic }, Math.max(0, seconds));
}

export function setDlqDepth(queue: string, depth: number): void {
  bullmqDlqDepth.set({ queue }, Math.max(0, depth));
}

export function incBillingRecon(result: "checked" | "diverged" | "completed"): void {
  billingReconTotal.inc({ result });
}

export function incBillingWebhook(
  result: "received" | "applied" | "duplicate" | "rejected",
): void {
  billingWebhookTotal.inc({ result });
}

export function incFinanceProjection(
  result: "hit" | "miss" | "computed" | "failed" | "invalidated" | "requested" | "duplicate" | "dlq",
): void {
  financeProjectionTotal.inc({ result });
}

export function incRetentionRun(job: string, result: "ok" | "error" | "dry-run"): void {
  retentionRunsTotal.inc({ job, result });
}

export function incRetentionPurged(job: string, by = 1): void {
  retentionPurgedTotal.inc({ job }, by);
}

export function incEmailSend(template: string, result: "sent" | "duplicate" | "dlq"): void {
  emailSendTotal.inc({ template, result });
}

export function incAuditEvent(action: string): void {
  auditEventsTotal.inc({ action });
}
