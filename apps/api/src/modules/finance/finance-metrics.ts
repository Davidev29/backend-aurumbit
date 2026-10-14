// Métricas finance.* (Fase 5, PROJECT.md §3 + REQUIREMENTS §3).
// In-memory por instância (hermético p/ e2e/unit). Produção: espelhar no
// Prometheus via libs/observability (mesmo padrão de `billing-metrics.ts`).

export type FinanceMetricName =
  | 'finance.ingest.applied'
  | 'finance.ingest.duplicate'
  | 'finance.transaction.posted'
  | 'finance.transaction.duplicate'
  | 'finance.receivable.received'
  | 'finance.payable.paid'
  | 'finance.projection.hit'
  | 'finance.projection.miss'
  | 'finance.projection.computed'
  | 'finance.read.denied'
  | 'finance.read.granted';

export class FinanceMetrics {
  private readonly counters = new Map<FinanceMetricName, number>();

  inc(name: FinanceMetricName, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  get(name: FinanceMetricName): number {
    return this.counters.get(name) ?? 0;
  }

  snapshot(): Record<FinanceMetricName, number> {
    return {
      'finance.ingest.applied': this.get('finance.ingest.applied'),
      'finance.ingest.duplicate': this.get('finance.ingest.duplicate'),
      'finance.transaction.posted': this.get('finance.transaction.posted'),
      'finance.transaction.duplicate': this.get('finance.transaction.duplicate'),
      'finance.receivable.received': this.get('finance.receivable.received'),
      'finance.payable.paid': this.get('finance.payable.paid'),
      'finance.projection.hit': this.get('finance.projection.hit'),
      'finance.projection.miss': this.get('finance.projection.miss'),
      'finance.projection.computed': this.get('finance.projection.computed'),
      'finance.read.denied': this.get('finance.read.denied'),
      'finance.read.granted': this.get('finance.read.granted'),
    };
  }
}
