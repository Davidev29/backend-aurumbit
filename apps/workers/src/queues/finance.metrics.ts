// Métricas finance.* do lado workers (Fase 5, PROJECT.md §§3/5).
// Contadores in-memory por processo (sem prom-client neste pacote; o wire
// Prometheus vive em libs/observability — TODO Fase 6 expor `finance_sync_*`
// e `finance_projection_*` no `/metrics` a partir destes contadores).
// Cobre os dois consumidores (`finance.sync` + `finance.projection.compute`)
// mais o ticker de invalidação — sem duplicar `billing.*`.

export type FinanceWorkerMetric =
  | 'finance.sync.received'
  | 'finance.sync.applied'
  | 'finance.sync.duplicate'
  | 'finance.sync.noop'
  | 'finance.sync.dlq'
  | 'finance.projection.requested'
  | 'finance.projection.computed'
  | 'finance.projection.duplicate'
  | 'finance.projection.dlq'
  | 'finance.projection.invalidated';

export class FinanceWorkerMetrics {
  private readonly counters = new Map<FinanceWorkerMetric, number>();

  inc(name: FinanceWorkerMetric, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  get(name: FinanceWorkerMetric): number {
    return this.counters.get(name) ?? 0;
  }

  snapshot(): Record<FinanceWorkerMetric, number> {
    return {
      'finance.sync.received': this.get('finance.sync.received'),
      'finance.sync.applied': this.get('finance.sync.applied'),
      'finance.sync.duplicate': this.get('finance.sync.duplicate'),
      'finance.sync.noop': this.get('finance.sync.noop'),
      'finance.sync.dlq': this.get('finance.sync.dlq'),
      'finance.projection.requested': this.get('finance.projection.requested'),
      'finance.projection.computed': this.get('finance.projection.computed'),
      'finance.projection.duplicate': this.get('finance.projection.duplicate'),
      'finance.projection.dlq': this.get('finance.projection.dlq'),
      'finance.projection.invalidated': this.get('finance.projection.invalidated'),
    };
  }

  /** Reset test-only (specs herméticos). */
  reset(): void {
    this.counters.clear();
  }
}

/** Instância compartilhada do processo worker (mesmo padrão billing.metrics). */
const shared = new FinanceWorkerMetrics();

export function financeMetricInc(name: FinanceWorkerMetric, by = 1): void {
  shared.inc(name, by);
}

export function financeMetricGet(name: FinanceWorkerMetric): number {
  return shared.get(name);
}

export function financeMetricsSnapshot(): Record<FinanceWorkerMetric, number> {
  return shared.snapshot();
}

/** Reset test-only (specs herméticos). */
export function financeMetricsReset(): void {
  shared.reset();
}
