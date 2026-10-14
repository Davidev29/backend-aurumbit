import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RetentionMetrics } from './retention.metrics';
import { RETENTION_QUEUE, allRetentionJobs, retentionJobOptions, type RetentionJobName } from './retention.queues';
import { runRetentionPolicy, type RetentionPolicyResult, type RetentionSqlRunner } from './retention.service';

// Agendador da retenção (Fase 6).
// - Produção: 1 repeat BullMQ diário por política (`retention.daily`,
//   `repeat: { pattern: '30 3 * * *', tz: 'America/Sao_Paulo' }`).
//   O registro do repeat tenta `require('bullmq')` e cai p/ timers nativos
//   com warn quando ausente (mesmo padrão das filas billing/finance).
// - Execução default é dry-run (`RETENTION_DRY_RUN=0` p/ purge real de 1
//   batch — TODO wiring com Pools reais por domínio; sem `DATABASE_URL_*`
//   o tick é no-op registrado, nunca fantasma).
// - Sem nova dependência (`@nestjs/schedule` não instalado): timers nativos
//   com `unref()`; `onModuleInit` só agenda com `RETENTION_CRON_ENABLED=1`
//   (testes chamam `runDaily` direto — determinístico).

export const RETENTION_DAILY_MS = 24 * 60 * 60 * 1000;

function isDryRun(): boolean {
  return (process.env.RETENTION_DRY_RUN ?? '1') !== '0';
}

function nullDb(): RetentionSqlRunner {
  return { query: async () => ({ rowCount: 0, rows: [{ count: 0 }] }) };
}

@Injectable()
export class RetentionCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionCron.name);
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private destroyed = false;
  readonly metrics = new RetentionMetrics();

  /** Tick diário de todas as políticas (dry-run default). */
  async runDaily(
    db: RetentionSqlRunner = nullDb(),
    now: Date = new Date(),
    dryRun = isDryRun(),
  ): Promise<{ results: RetentionPolicyResult[]; dryRun: boolean }> {
    const results: RetentionPolicyResult[] = [];
    for (const job of allRetentionJobs()) {
      const r = await runRetentionPolicy(db, this.metrics, job as RetentionJobName, { dryRun, now });
      results.push(r);
    }
    this.logger.log(
      JSON.stringify({
        event: 'retention.daily',
        dryRun,
        counts: Object.fromEntries(results.map((r) => [r.policy, r.count])),
        at: now.toISOString(),
      }),
    );
    return { results, dryRun };
  }

  /** Registra os repeats BullMQ diários (produção com Redis; warn sem). */
  async registerRepeats(): Promise<{ registered: boolean; queue: string; jobs: RetentionJobName[] }> {
    const jobs = allRetentionJobs();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Queue } = require('bullmq') as { Queue?: new (name: string, opts: { connection: unknown }) => { add(n: string, d: unknown, o: unknown): Promise<unknown> } };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require('ioredis');
      if (!process.env.REDIS_URL || !Queue) throw new Error('sem REDIS_URL/bullmq');
      const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
      connection.on('error', () => undefined);
      const queue = new Queue(RETENTION_QUEUE, { connection });
      for (const job of jobs) {
        await queue.add(job, { policy: job, dryRun: isDryRun() }, retentionJobOptions(job));
      }
      return { registered: true, queue: RETENTION_QUEUE, jobs };
    } catch {
      this.logger.warn(
        JSON.stringify({ event: 'retention.repeat.skip', reason: 'sem bullmq/REDIS_URL (timers nativos)', queue: RETENTION_QUEUE }),
      );
      return { registered: false, queue: RETENTION_QUEUE, jobs };
    }
  }

  onModuleInit(): void {
    void this.registerRepeats();
    if (process.env.RETENTION_CRON_ENABLED !== '1') return;
    const tick = (): void => {
      if (this.destroyed) return;
      this.runDaily()
        .catch((e) => this.logger.error(`retention daily falhou: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => {
          if (!this.destroyed) {
            const t = setTimeout(tick, RETENTION_DAILY_MS);
            t.unref?.();
            this.timers.push(t);
          }
        });
    };
    const first = setTimeout(tick, RETENTION_DAILY_MS);
    first.unref?.();
    this.timers.push(first);
    this.logger.log(JSON.stringify({ event: 'retention.cron.armed', queue: RETENTION_QUEUE, dryRun: isDryRun() }));
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    for (const t of this.timers) clearTimeout(t as unknown as NodeJS.Timeout);
    this.timers = [];
  }
}
