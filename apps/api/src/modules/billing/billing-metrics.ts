// Contadores billing.webhook.* + billing.recon.* (Fase 4, PROJECT.md §5).
// In-memory por instância (hermético p/ e2e/unit). Produção: espelhar no
// Prometheus via libs/observability (`billingReconTotal` já existe como stub;
// `billing_webhook_*` entram no próximo dashboard — TODO Fase 5).

export type BillingMetricName =
  | 'billing.webhook.received'
  | 'billing.webhook.applied'
  | 'billing.webhook.duplicate'
  | 'billing.webhook.rejected'
  | 'billing.recon.checked'
  | 'billing.recon.diverged'
  | 'billing.recon.completed';

export class BillingMetrics {
  private readonly counters = new Map<BillingMetricName, number>();

  inc(name: BillingMetricName, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  get(name: BillingMetricName): number {
    return this.counters.get(name) ?? 0;
  }

  snapshot(): Record<BillingMetricName, number> {
    return {
      'billing.webhook.received': this.get('billing.webhook.received'),
      'billing.webhook.applied': this.get('billing.webhook.applied'),
      'billing.webhook.duplicate': this.get('billing.webhook.duplicate'),
      'billing.webhook.rejected': this.get('billing.webhook.rejected'),
      'billing.recon.checked': this.get('billing.recon.checked'),
      'billing.recon.diverged': this.get('billing.recon.diverged'),
      'billing.recon.completed': this.get('billing.recon.completed'),
    };
  }
}
