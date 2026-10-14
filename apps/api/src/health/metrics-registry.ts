// Registro Prometheus autocontido da API — Fase 6 (Obs + SLOs).
// Zero dependências externas (sem prom-client neste pacote): espelha os nomes
// de `libs/observability` (`metrics.ts` é a fonte dos nomes; este arquivo é o
// exposition HTTP até a API depender do lib via workspace).
// Nomes lógicos (PROJECT §5) → Prometheus (`*` = label):
// - http_requests_total{method,route,status} + http_request_duration_seconds{*}
// - outbox_lag_seconds{topic} · bullmq_dlq_depth{queue}
// - billing_recon_total{result} · billing_webhook_total{result}
// - finance_projection_total{result}
// - retention_runs_total{job,result} · retention_purged_total{job}
// - email_send_total{template,result} · audit_events_total{action}
// Hermético p/ testes (reset test-only). Produção: gauges zerados no boot via
// `seedPhase6Series()` para os dashboards verem as séries antes do 1º evento.

const HISTOGRAM_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

type Labels = Record<string, string>;

function keyOf(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

function fmtLabels(labels: Labels): string {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k].replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

class Counter {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  inc(labels: Labels = {}, by = 1): void {
    const k = keyOf(labels);
    const cur = this.values.get(k);
    this.values.set(k, { labels: { ...labels }, value: (cur?.value ?? 0) + by });
  }
  reset(): void {
    this.values.clear();
  }
  samples(name: string): string[] {
    return [...this.values.values()].map((s) => `${name}${fmtLabels(s.labels)} ${s.value}`);
  }
}

class Gauge {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  set(labels: Labels, value: number): void {
    this.values.set(keyOf(labels), { labels: { ...labels }, value });
  }
  reset(): void {
    this.values.clear();
  }
  samples(name: string): string[] {
    return [...this.values.values()].map((s) => `${name}${fmtLabels(s.labels)} ${s.value}`);
  }
}

class Histogram {
  private readonly buckets = new Map<string, { labels: Labels; counts: number[] }>();
  private readonly sums = new Map<string, { labels: Labels; sum: number; count: number }>();
  observe(labels: Labels, value: number): void {
    const k = keyOf(labels);
    let b = this.buckets.get(k);
    if (!b) {
      b = { labels: { ...labels }, counts: HISTOGRAM_BUCKETS.map(() => 0) };
      this.buckets.set(k, b);
    }
    HISTOGRAM_BUCKETS.forEach((bound, i) => {
      if (value <= bound) b!.counts[i] += 1;
    });
    const s = this.sums.get(k) ?? { labels: { ...labels }, sum: 0, count: 0 };
    s.sum += value;
    s.count += 1;
    this.sums.set(k, s);
  }
  reset(): void {
    this.buckets.clear();
    this.sums.clear();
  }
  samples(name: string): string[] {
    const out: string[] = [];
    for (const { labels, counts } of this.buckets.values()) {
      HISTOGRAM_BUCKETS.forEach((bound, i) => {
        out.push(`${name}_bucket${fmtLabels({ ...labels, le: String(bound) })} ${counts[i]}`);
      });
      const s = this.sums.get(keyOf(labels));
      out.push(`${name}_bucket${fmtLabels({ ...labels, le: '+Inf' })} ${s?.count ?? 0}`);
      out.push(`${name}_sum${fmtLabels(labels)} ${s?.sum ?? 0}`);
      out.push(`${name}_count${fmtLabels(labels)} ${s?.count ?? 0}`);
    }
    return out;
  }
}

function help(name: string, doc: string, type: 'counter' | 'gauge' | 'histogram'): string {
  return [`# HELP ${name} ${doc}`, `# TYPE ${name} ${type}`].join('\n');
}

export const httpRequestsTotal = new Counter();
export const httpRequestDuration = new Histogram();
export const outboxLagSeconds = new Gauge();
export const bullmqDlqDepth = new Gauge();
export const billingReconTotal = new Counter();
export const billingWebhookTotal = new Counter();
export const financeProjectionTotal = new Counter();
export const retentionRunsTotal = new Counter();
export const retentionPurgedTotal = new Counter();
export const emailSendTotal = new Counter();
export const auditEventsTotal = new Counter();

export function observeHttpRequest(method: string, route: string, status: number | string, seconds: number): void {
  const labels = { method, route, status: String(status) };
  httpRequestsTotal.inc(labels);
  httpRequestDuration.observe(labels, Math.max(0, seconds));
}

export function setOutboxLag(topic: string, seconds: number): void {
  outboxLagSeconds.set({ topic }, Math.max(0, seconds));
}

export function setDlqDepth(queue: string, depth: number): void {
  bullmqDlqDepth.set({ queue }, Math.max(0, depth));
}

/** Zera séries conhecidas no boot para os dashboards verem `0` antes do 1º evento. */
export function seedPhase6Series(queues: string[] = [], topics: string[] = []): void {
  for (const queue of queues) setDlqDepth(queue, 0);
  for (const topic of topics) setOutboxLag(topic, 0);
}

export function resetMetricsForTests(): void {
  for (const c of [
    httpRequestsTotal,
    billingReconTotal,
    billingWebhookTotal,
    financeProjectionTotal,
    retentionRunsTotal,
    retentionPurgedTotal,
    emailSendTotal,
    auditEventsTotal,
  ]) {
    c.reset();
  }
  for (const g of [outboxLagSeconds, bullmqDlqDepth]) g.reset();
  httpRequestDuration.reset();
}

const BUILD_VERSION = process.env.APP_VERSION ?? '0.0.0-fase6';
const BUILD_SHA = process.env.GIT_SHA ?? 'unknown';

export function metricsExposition(): string {
  const sections: string[] = [
    [
      help('http_requests_total', 'Total de requisicoes HTTP por rota/metodo/status.', 'counter'),
      ...httpRequestsTotal.samples('http_requests_total'),
    ].join('\n'),
    [
      help('http_request_duration_seconds', 'Duracao das requisicoes HTTP em segundos.', 'histogram'),
      ...httpRequestDuration.samples('http_request_duration_seconds'),
    ].join('\n'),
    [
      help('outbox_lag_seconds', 'Lag da outbox em segundos por topico (0 = drenada).', 'gauge'),
      ...outboxLagSeconds.samples('outbox_lag_seconds'),
    ].join('\n'),
    [
      help('bullmq_dlq_depth', 'Mensagens na DLQ por fila BullMQ.', 'gauge'),
      ...bullmqDlqDepth.samples('bullmq_dlq_depth'),
    ].join('\n'),
    [
      help('billing_recon_total', 'Reconciliacoes Asaas por resultado (PROJECT.md secao 5).', 'counter'),
      ...billingReconTotal.samples('billing_recon_total'),
    ].join('\n'),
    [
      help('billing_webhook_total', 'Webhooks Asaas por resultado.', 'counter'),
      ...billingWebhookTotal.samples('billing_webhook_total'),
    ].join('\n'),
    [
      help('finance_projection_total', 'Projecoes financeiras por resultado.', 'counter'),
      ...financeProjectionTotal.samples('finance_projection_total'),
    ].join('\n'),
    [
      help('retention_runs_total', 'Execucoes de jobs de retencao por job/resultado.', 'counter'),
      ...retentionRunsTotal.samples('retention_runs_total'),
    ].join('\n'),
    [
      help('retention_purged_total', 'Linhas purgadas por job de retencao.', 'counter'),
      ...retentionPurgedTotal.samples('retention_purged_total'),
    ].join('\n'),
    [
      help('email_send_total', 'Envios de e-mail por template/resultado.', 'counter'),
      ...emailSendTotal.samples('email_send_total'),
    ].join('\n'),
    [
      help('audit_events_total', 'Eventos de auditoria emitidos por acao.', 'counter'),
      ...auditEventsTotal.samples('audit_events_total'),
    ].join('\n'),
    [
      help('app_build_info', 'Info estatica de build (version/sha).', 'gauge'),
      `app_build_info{version="${BUILD_VERSION}",sha="${BUILD_SHA}"} 1`,
    ].join('\n'),
  ];
  return sections.join('\n') + '\n';
}

export function metricsContentType(): string {
  return 'text/plain; version=0.0.4; charset=utf-8';
}
