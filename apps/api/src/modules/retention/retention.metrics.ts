// Métricas retention.* (Fase 6, PROJECT.md §4).
// In-memory por instância (hermético p/ unit/e2e). Produção: espelhar no
// Prometheus via libs/observability (mesmo padrão de `billing-metrics.ts`).

export type RetentionMetricName =
  | 'retention.outbox.purged'
  | 'retention.email_vars.anonymized'
  | 'retention.session.purged'
  | 'retention.ip_hash.purged'
  | 'retention.device_hash.anonymized'
  | 'retention.dry_run';

export class RetentionMetrics {
  private readonly counters = new Map<RetentionMetricName, number>();

  inc(name: RetentionMetricName, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  get(name: RetentionMetricName): number {
    return this.counters.get(name) ?? 0;
  }

  snapshot(): Record<RetentionMetricName, number> {
    return {
      'retention.outbox.purged': this.get('retention.outbox.purged'),
      'retention.email_vars.anonymized': this.get('retention.email_vars.anonymized'),
      'retention.ip_hash.purged': this.get('retention.ip_hash.purged'),
      'retention.session.purged': this.get('retention.session.purged'),
      'retention.device_hash.anonymized': this.get('retention.device_hash.anonymized'),
      'retention.dry_run': this.get('retention.dry_run'),
    };
  }
}
