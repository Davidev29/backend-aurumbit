import { RetentionMetrics } from './retention.metrics';
import type { RetentionJobName } from './retention.queues';

// Políticas de retenção (Fase 6, PROJECT.md §4 + LGPD).
// Puro quanto a SQL + orquestração injetável (sem PG direto): `db` é
// `{ query }` (Pool do domínio) e `metrics` é `RetentionMetrics`.
// - dry-run (default): conta elegíveis SEM deletar/anonimizar + métrica
//   `retention.dry_run`. É o modo dos testes e do `runDaily()` default.
// - purge real: TODO(Fase 6-hardening) — executar os builders abaixo com
//   `DELETE/UPDATE` limitado (`... WHERE ctid IN (SELECT ... LIMIT 500)`)
//   em loop até `rowCount < batch`. Os builders já limitam o batch; falta
//   só o wiring com Pools reais por domínio (nunca ad-hoc manual).

export const RETENTION_POLICIES = {
  outboxPurge: { retentionDays: 30, description: 'outbox_events publicados há +30d → DELETE' },
  emailVarsAnon: { retentionDays: 90, description: 'email vars com PII há +90d → anonimiza vars' },
  sessionPurge: { retentionDays: 30, description: 'sessões expiradas há +30d (exp+30d) → DELETE' },
  ipHashPurge: { retentionDays: 90, description: 'ip_hash há +90d → DELETE' },
  deviceHashAnon: { retentionDays: 365, description: 'device_hash de licença expirada há +12m → anonimiza' },
} as const;

export const RETENTION_BATCH = 500;

export interface RetentionSqlRunner {
  query(sql: string, params?: unknown[]): Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }>;
}

export interface RetentionPolicyResult {
  policy: RetentionJobName;
  dryRun: boolean;
  /** Elegíveis (dry-run) ou removidos/anonimizados (purge real). */
  count: number;
  cutoff: string;
}

/** Corte ISO (`now - days`). */
export function retentionCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// --- builders (DELETE/UPDATE limitado por batch; TODO wiring real) ---------

export function buildOutboxPurgeSql(batch = RETENTION_BATCH): string {
  return (
    `DELETE FROM outbox_events WHERE ctid IN (` +
    `SELECT ctid FROM outbox_events WHERE published = true AND "occurredAt" < now() - interval '30 days' ` +
    `ORDER BY "occurredAt" ASC LIMIT ${batch})`
  );
}

export function buildEmailVarsAnonSql(batch = RETENTION_BATCH): string {
  return (
    `UPDATE email_messages SET vars = '{}' WHERE ctid IN (` +
    `SELECT ctid FROM email_messages WHERE "createdAt" < now() - interval '90 days' AND vars <> '{}' ` +
    `ORDER BY "createdAt" ASC LIMIT ${batch})`
  );
}

export function buildSessionPurgeSql(batch = RETENTION_BATCH): string {
  return (
    `DELETE FROM sessions WHERE ctid IN (` +
    `SELECT ctid FROM sessions WHERE "expiresAt" < now() - interval '30 days' ` +
    `ORDER BY "expiresAt" ASC LIMIT ${batch})`
  );
}

export function buildIpHashPurgeSql(batch = RETENTION_BATCH): string {
  return (
    `DELETE FROM ip_hashes WHERE ctid IN (` +
    `SELECT ctid FROM ip_hashes WHERE "createdAt" < now() - interval '90 days' ` +
    `ORDER BY "createdAt" ASC LIMIT ${batch})`
  );
}

export function buildDeviceHashAnonSql(batch = RETENTION_BATCH): string {
  return (
    `UPDATE device_links SET device_hash = 'anon' WHERE ctid IN (` +
    `SELECT ctid FROM device_links WHERE "licenseExpiresAt" < now() - interval '12 months' AND device_hash <> 'anon' ` +
    `ORDER BY "licenseExpiresAt" ASC LIMIT ${batch})`
  );
}

export function retentionSqlFor(policy: RetentionJobName, batch = RETENTION_BATCH): string {
  switch (policy) {
    case 'retention.outbox-purge':
      return buildOutboxPurgeSql(batch);
    case 'retention.email-vars-anon':
      return buildEmailVarsAnonSql(batch);
    case 'retention.session-purge':
      return buildSessionPurgeSql(batch);
    case 'retention.ip-hash-purge':
      return buildIpHashPurgeSql(batch);
    case 'retention.device-hash-anon':
      return buildDeviceHashAnonSql(batch);
  }
}

export function retentionCountSqlFor(policy: RetentionJobName, now: Date = new Date()): { sql: string; params: [string] } {
  const cutoffDays: Record<RetentionJobName, number> = {
    'retention.outbox-purge': 30,
    'retention.email-vars-anon': 90,
    'retention.session-purge': 30,
    'retention.ip-hash-purge': 90,
    'retention.device-hash-anon': 365,
  };
  const cutoff = retentionCutoff(now, cutoffDays[policy]);
  const where: Record<RetentionJobName, string> = {
    'retention.outbox-purge': `published = true AND "occurredAt" < $1`,
    'retention.email-vars-anon': `"createdAt" < $1`,
    'retention.session-purge': `"expiresAt" < $1`,
    'retention.ip-hash-purge': `"createdAt" < $1`,
    'retention.device-hash-anon': `"licenseExpiresAt" < $1`,
  };
  const table: Record<RetentionJobName, string> = {
    'retention.outbox-purge': 'outbox_events',
    'retention.email-vars-anon': 'email_messages',
    'retention.session-purge': 'sessions',
    'retention.ip-hash-purge': 'ip_hashes',
    'retention.device-hash-anon': 'device_links',
  };
  return { sql: `SELECT COUNT(*)::int AS count FROM ${table[policy]} WHERE ${where[policy]}`, params: [cutoff] };
}

const POLICY_METRIC: Record<RetentionJobName, 'retention.outbox.purged' | 'retention.email_vars.anonymized' | 'retention.session.purged' | 'retention.ip_hash.purged' | 'retention.device_hash.anonymized'> = {
  'retention.outbox-purge': 'retention.outbox.purged',
  'retention.email-vars-anon': 'retention.email_vars.anonymized',
  'retention.session-purge': 'retention.session.purged',
  'retention.ip-hash-purge': 'retention.ip_hash.purged',
  'retention.device-hash-anon': 'retention.device_hash.anonymized',
};

/**
 * Executa UMA política. `dryRun: true` (default) conta elegíveis sem
 * mutar; `dryRun: false` executa 1 batch do builder (TODO loop + Pools
 * reais — hoje 1 batch por tick, idempotente no próximo tick).
 */
export async function runRetentionPolicy(
  db: RetentionSqlRunner,
  metrics: RetentionMetrics,
  policy: RetentionJobName,
  opts: { dryRun?: boolean; now?: Date; batch?: number } = {},
): Promise<RetentionPolicyResult> {
  const dryRun = opts.dryRun ?? true;
  const now = opts.now ?? new Date();
  const batch = opts.batch ?? RETENTION_BATCH;
  if (dryRun) {
    const { sql, params } = retentionCountSqlFor(policy, now);
    const { rows } = await db.query(sql, params);
    const count = Number((rows[0] as { count?: unknown } | undefined)?.count ?? 0);
    metrics.inc('retention.dry_run');
    return { policy, dryRun: true, count: Number.isFinite(count) ? count : 0, cutoff: now.toISOString() };
  }
  const { rowCount } = await db.query(retentionSqlFor(policy, batch));
  const count = rowCount ?? 0;
  metrics.inc(POLICY_METRIC[policy], count);
  return { policy, dryRun: false, count, cutoff: now.toISOString() };
}
