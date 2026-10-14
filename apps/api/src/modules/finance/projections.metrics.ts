/**
 * Projeções — métricas `finance.projection.*` (Fase 5).
 * In-memory por instância (hermético p/ testes), mesmo padrão de
 * `billing-metrics.ts`. Produção: espelhar no Prometheus via
 * libs/observability (TODO Fase 6).
 */

export type ProjectionMetricName =
  | 'finance.projection.requested'
  | 'finance.projection.hit'
  | 'finance.projection.miss'
  | 'finance.projection.queued'
  | 'finance.projection.computed'
  | 'finance.projection.failed'
  | 'finance.projection.invalidated';

export class ProjectionMetrics {
  private readonly counters = new Map<ProjectionMetricName, number>();
  private computeCount = 0;
  private computeTotalMs = 0;
  private computeMaxMs = 0;

  inc(name: ProjectionMetricName, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  get(name: ProjectionMetricName): number {
    return this.counters.get(name) ?? 0;
  }

  observeCompute(ms: number): void {
    this.computeCount += 1;
    this.computeTotalMs += ms;
    if (ms > this.computeMaxMs) this.computeMaxMs = ms;
  }

  snapshot(): Record<ProjectionMetricName, number> & {
    computeCount: number;
    computeAvgMs: number;
    computeMaxMs: number;
  } {
    return {
      'finance.projection.requested': this.get('finance.projection.requested'),
      'finance.projection.hit': this.get('finance.projection.hit'),
      'finance.projection.miss': this.get('finance.projection.miss'),
      'finance.projection.queued': this.get('finance.projection.queued'),
      'finance.projection.computed': this.get('finance.projection.computed'),
      'finance.projection.failed': this.get('finance.projection.failed'),
      'finance.projection.invalidated': this.get('finance.projection.invalidated'),
      computeCount: this.computeCount,
      computeAvgMs: this.computeCount === 0 ? 0 : Math.round(this.computeTotalMs / this.computeCount),
      computeMaxMs: this.computeMaxMs,
    };
  }
}
