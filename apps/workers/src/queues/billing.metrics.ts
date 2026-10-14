// Métricas billing.* do lado workers (Fase 4, PROJECT.md §5).
// Contadores in-memory por processo (sem prom-client neste pacote; o wire
// Prometheus vive em libs/observability — TODO Fase 5 expor `billing_webhook_*`
// no `/metrics` a partir destes contadores).

export type BillingWorkerMetric =
  | 'billing.webhook.received'
  | 'billing.webhook.applied'
  | 'billing.webhook.duplicate'
  | 'billing.webhook.rejected'
  | 'billing.webhook.dlq'
  | 'billing.recon.checked'
  | 'billing.recon.diverged'
  | 'billing.recon.completed'
  | 'billing.fanout.delivered'
  | 'billing.fanout.dlq';

const counters = new Map<BillingWorkerMetric, number>();

export function billingMetricInc(name: BillingWorkerMetric, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function billingMetricGet(name: BillingWorkerMetric): number {
  return counters.get(name) ?? 0;
}

export function billingMetricsSnapshot(): Record<BillingWorkerMetric, number> {
  return {
    'billing.webhook.received': billingMetricGet('billing.webhook.received'),
    'billing.webhook.applied': billingMetricGet('billing.webhook.applied'),
    'billing.webhook.duplicate': billingMetricGet('billing.webhook.duplicate'),
    'billing.webhook.rejected': billingMetricGet('billing.webhook.rejected'),
    'billing.webhook.dlq': billingMetricGet('billing.webhook.dlq'),
    'billing.recon.checked': billingMetricGet('billing.recon.checked'),
    'billing.recon.diverged': billingMetricGet('billing.recon.diverged'),
    'billing.recon.completed': billingMetricGet('billing.recon.completed'),
    'billing.fanout.delivered': billingMetricGet('billing.fanout.delivered'),
    'billing.fanout.dlq': billingMetricGet('billing.fanout.dlq'),
  };
}

/** Reset test-only (specs herméticos). */
export function billingMetricsReset(): void {
  counters.clear();
}
