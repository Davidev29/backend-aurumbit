// Filas/agendamento da retenção LGPD (Fase 6, PROJECT.md §4).
// - 5 políticas (1 job cada) com repeat diário BullMQ (`repeat: { pattern }`).
// - Sem import estático de `bullmq` (apps/api não o declara): o scheduler
//   tenta `require('bullmq')` e cai p/ timers nativos com warn quando ausente
//   — mesmo padrão de `billing/webhook.queue.ts` e `finance/projections.queue.ts`.
// - Execução real vive em `retention.service.ts` (dry-run default) com
//   métricas `retention.*` (ver `retention.metrics.ts`).
// - TODO(Fase 6-hardening): purge real com `DELETE` limitado + batch
//   (ver builders em `retention.service.ts`).

export const RETENTION_QUEUE = 'retention.daily';

export const RETENTION_JOBS = {
  outboxPurge: 'retention.outbox-purge',
  emailVarsAnon: 'retention.email-vars-anon',
  sessionPurge: 'retention.session-purge',
  ipHashPurge: 'retention.ip-hash-purge',
  deviceHashAnon: 'retention.device-hash-anon',
} as const;

export type RetentionJobName = (typeof RETENTION_JOBS)[keyof typeof RETENTION_JOBS];

/** Repeat diário 03:30 America/Sao_Paulo (fora do pico + após recon daily 03:00). */
export const RETENTION_SCHEDULE = {
  pattern: '30 3 * * *',
  timezone: 'America/Sao_Paulo',
} as const;

/** jobId fixo por política (dedupe do repeat no restart; 1 tick/dia). */
export function retentionJobId(job: RetentionJobName): string {
  return `retention-daily:${job}`;
}

export function retentionJobOptions(job: RetentionJobName): {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  repeat: { pattern: string; tz: string };
  removeOnComplete: number;
  removeOnFail: number;
} {
  return {
    jobId: retentionJobId(job),
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    repeat: { pattern: RETENTION_SCHEDULE.pattern, tz: RETENTION_SCHEDULE.timezone },
    removeOnComplete: 100,
    removeOnFail: 500,
  };
}

/** Todas as políticas (p/ o scheduler registrar 1 repeat cada). */
export function allRetentionJobs(): RetentionJobName[] {
  return Object.values(RETENTION_JOBS);
}
