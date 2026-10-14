import { RetentionMetrics } from './retention.metrics';
import {
  RETENTION_BATCH,
  buildDeviceHashAnonSql,
  buildEmailVarsAnonSql,
  buildIpHashPurgeSql,
  buildOutboxPurgeSql,
  buildSessionPurgeSql,
  retentionCountSqlFor,
  retentionCutoff,
  runRetentionPolicy,
  type RetentionSqlRunner,
} from './retention.service';
import { allRetentionJobs, retentionJobId, retentionJobOptions, RETENTION_SCHEDULE } from './retention.queues';

function countDb(count: number): RetentionSqlRunner & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.startsWith('SELECT COUNT')) return { rowCount: 1, rows: [{ count }] };
      return { rowCount: 0, rows: [] };
    },
  };
}

describe('retenção — políticas e dry-run (Fase 6)', () => {
  it('5 políticas cobertas com repeat diário + jobId fixo (dedupe)', () => {
    expect(allRetentionJobs()).toHaveLength(5);
    for (const job of allRetentionJobs()) {
      expect(retentionJobId(job)).toContain('retention-daily:');
      const opts = retentionJobOptions(job);
      expect(opts.repeat).toEqual({ pattern: RETENTION_SCHEDULE.pattern, tz: 'America/Sao_Paulo' });
      expect(opts.jobId).toBe(retentionJobId(job));
    }
  });

  it('builders limitam batch e filtram pela janela (TODO purge real)', () => {
    expect(buildOutboxPurgeSql()).toContain('published = true');
    expect(buildOutboxPurgeSql()).toContain(`interval '30 days'`);
    expect(buildOutboxPurgeSql()).toContain(`LIMIT ${RETENTION_BATCH}`);
    expect(buildEmailVarsAnonSql()).toContain(`interval '90 days'`);
    expect(buildSessionPurgeSql()).toContain(`interval '30 days'`);
    expect(buildIpHashPurgeSql()).toContain(`interval '90 days'`);
    expect(buildDeviceHashAnonSql()).toContain(`interval '12 months'`);
  });

  it('cutoff = now - janela (outbox 30d, device_hash licença+12m)', () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    expect(retentionCutoff(now, 30)).toBe('2026-09-10T12:00:00.000Z');
    const { params } = retentionCountSqlFor('retention.device-hash-anon');
    expect(params).toHaveLength(1);
  });

  it('dry-run conta elegíveis SEM mutar + métrica retention.dry_run', async () => {
    const db = countDb(7);
    const metrics = new RetentionMetrics();
    const out = await runRetentionPolicy(db, metrics, 'retention.outbox-purge', { dryRun: true });
    expect(out).toMatchObject({ policy: 'retention.outbox-purge', dryRun: true, count: 7 });
    expect(db.queries.some((q) => q.startsWith('SELECT COUNT'))).toBe(true);
    expect(db.queries.some((q) => q.startsWith('DELETE'))).toBe(false);
    expect(metrics.get('retention.dry_run')).toBe(1);
    expect(metrics.get('retention.outbox.purged')).toBe(0);
  });

  it('purge real (1 batch) executa DELETE limitado + métrica retention.*', async () => {
    const db: RetentionSqlRunner = {
      query: async (sql: string) => {
        if (sql.startsWith('DELETE')) return { rowCount: 3, rows: [] };
        return { rowCount: 0, rows: [] };
      },
    };
    const metrics = new RetentionMetrics();
    const out = await runRetentionPolicy(db, metrics, 'retention.session-purge', { dryRun: false, batch: 500 });
    expect(out).toMatchObject({ dryRun: false, count: 3 });
    expect(metrics.get('retention.session.purged')).toBe(3);
  });
});
