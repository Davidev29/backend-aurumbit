import { Queue, Worker } from 'bullmq';
import dotenv from 'dotenv';
import Redis from 'ioredis';
import pino from 'pino';
import { z } from 'zod';
import { handleSyncJob } from './queues/licensing.sync';
import { runEvaluateTick } from './queues/licensing.evaluate';
import { LICENSING_QUEUES, EVALUATE_EVERY_MS, SYNC_BACKOFF_MS, SYNC_MAX_ATTEMPTS } from './queues/licensing.queues';
import { BILLING_QUEUES, RECON_HOURLY_MS, billingJobOptions } from './queues/billing.queues';
import { FINANCE_QUEUES, financeSyncJobOptions } from './queues/finance.queues';
import {
  FINANCE_PROJECTION_QUEUE,
  PROJECTION_INVALIDATION_MS,
  handleFinanceProjectionJob,
  runProjectionInvalidationTick,
} from './queues/finance.projection';
import { FinanceWorkerMetrics } from './queues/finance.metrics';
import { handleFinanceSyncJob } from './queues/finance.sync';
import {
  FINANCE_AUTO_CHARGE_ENDPOINT,
  FINANCE_AUTO_CHARGE_QUEUE,
  FINANCE_BILL_PAY_ENDPOINT,
  FINANCE_BILL_PAY_QUEUE,
  handleFinanceAutomationJob,
} from './queues/finance.automation';
import { handleBillingWebhookJob } from './queues/billing.webhook';
import { runReconTick } from './queues/billing.recon';
import { PAYMENT_CONFIRMED_TOPIC, fanOutPaymentConfirmed } from './queues/comms.fanout';
import { OUTBOX_RELAY_DOMAINS, runOutboxRelayTick } from './queues/outbox.relay';

dotenv.config();

// Fase 3 — wiring real das filas licensing + stub communications.
// - `licensing.evaluate`: ticker repeat 5min → POST /v1/access/admin/evaluate.
// - `licensing.sync`: consome outbox licensing/access (jobId=eventId), retry
//   exponencial 5x + DLQ `licensing.dlq` (replay manual preserva eventId).
// - `communications.send` (stub): TODO(Fase 4) Resend real com
//   idempotencyKey=eventId + templates versionados (PROJECT.md §§5-6).
//   O stub apenas registra e confirma (sem envio) para não bloquear o pipeline.
const envSchema = z.object({
  REDIS_URL: z.string().min(1, 'REDIS_URL é obrigatório'),
  API_BASE_URL: z.string().default('http://localhost:3000'),
  QUEUE_NAME: z.string().default('aurum-bit-events'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Env inválida (fail-fast): ${details}`);
  }
  return parsed.data;
}

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL });

function createConnection(): Redis {
  // BullMQ exige maxRetriesPerRequest: null; cada Queue/Worker usa conexão própria.
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

async function main(): Promise<void> {
  const probe = createConnection();
  try {
    await probe.ping();
  } finally {
    probe.disconnect();
  }
  logger.info('workers boot: redis up (health)');

  // Filas (produtor): sync + evaluate + dlq + comms stub.
  const syncQueue = new Queue(LICENSING_QUEUES.sync, { connection: createConnection() });
  const evaluateQueue = new Queue(LICENSING_QUEUES.evaluate, { connection: createConnection() });
  const dlqQueue = new Queue(LICENSING_QUEUES.dlq, { connection: createConnection() });
  const commsQueue = new Queue('communications.send', { connection: createConnection() });

  // Filas billing (Fase 4): webhook.apply + recon + fanout + dlq.
  const billingWebhookQueue = new Queue(BILLING_QUEUES.webhookApply, { connection: createConnection() });
  const billingReconQueue = new Queue(BILLING_QUEUES.recon, { connection: createConnection() });
  const billingFanoutQueue = new Queue(BILLING_QUEUES.fanout, { connection: createConnection() });
  const billingDlqQueue = new Queue(BILLING_QUEUES.dlq, { connection: createConnection() });
  void billingJobOptions;

  // Filas finance (Fase 5): sync billing→finance + dlq.
  const financeSyncQueue = new Queue(FINANCE_QUEUES.sync, { connection: createConnection() });
  const financeDlqQueue = new Queue(FINANCE_QUEUES.dlq, { connection: createConnection() });
  void financeSyncJobOptions;

  // Filas automação financeira: bill-pay (despesas via Asaas) + auto-charge
  // (receitas automáticas). `jobId = finance:*:<idempotencyKey>` (dedupe).
  const financeBillPayQueue = new Queue(FINANCE_BILL_PAY_QUEUE, { connection: createConnection() });
  const financeAutoChargeQueue = new Queue(FINANCE_AUTO_CHARGE_QUEUE, { connection: createConnection() });

  // Fila `finance.projection.compute` (jobId = scope:ref:hash; polling do 202).
  const financeProjectionQueue = new Queue(FINANCE_PROJECTION_QUEUE, { connection: createConnection() });
  const financeMetrics = new FinanceWorkerMetrics();

  // Ticker evaluate a cada 5min (jobId fixo evita duplicar o repeat no restart).
  await evaluateQueue.add(
    'tick',
    {},
    { repeat: { every: EVALUATE_EVERY_MS }, jobId: 'licensing-evaluate-ticker' },
  );

  // Ticker recon hourly (pendentes <7d). Daily 03:00 America/SP (30d) é um
  // segundo repeat com jobId próprio (mesmo handler, janela filtrada na API).
  await billingReconQueue.add(
    'tick-hourly',
    { window: 'hourly' },
    { repeat: { every: RECON_HOURLY_MS }, jobId: 'billing-recon-ticker-hourly' },
  );

  const evaluateWorker = new Worker(
    LICENSING_QUEUES.evaluate,
    async () => {
      const out = await runEvaluateTick({ apiBaseUrl: env.API_BASE_URL });
      logger.info({ window: out.window, status: out.status }, 'licensing.evaluate tick ok');
      return out;
    },
    { connection: createConnection() },
  );
  evaluateWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, err }, 'licensing.evaluate falhou (retry pelo BullMQ)'),
  );

  const syncWorker = new Worker(
    LICENSING_QUEUES.sync,
    async (job) =>
      handleSyncJob(
        { id: job.id, data: job.data, attemptsMade: job.attemptsMade },
        {
          maxAttempts: SYNC_MAX_ATTEMPTS,
          // Efeito real (upsert entitlement + outbox + cache) vive na API
          // (LicensingSyncService.handleEnvelope, AccessModule — Fase 4 pluga
          // via HTTP interno). O worker nunca escreve PG direto aqui; registra
          // e confirma para manter o pipeline drenando sem fantasma.
          // TODO(Fase 4): POST interno p/ API com idempotency eventId.
          applyEnvelope: async (envelope) => {
            logger.info(
              { eventId: envelope.eventId, topic: envelope.topic },
              'licensing.sync envelope recebido (TODO Fase 4: aplicar via API)',
            );
          },
          moveToDlq: async (jobId, data, reason) => {
            await dlqQueue.add('dlq', data, { jobId });
            logger.warn({ jobId, eventId: data.eventId, reason }, 'licensing.sync → DLQ');
          },
        },
      ),
    {
      connection: createConnection(),
      concurrency: 5,
    },
  );
  // Backoff exponencial configurado na produção (syncJobOptions); o worker
  // só registra falhas — o BullMQ reagenda até SYNC_MAX_ATTEMPTS.
  void SYNC_BACKOFF_MS;
  syncWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'licensing.sync falhou'),
  );

  // Stub communications (TODO Fase 4 — Resend): consome sem enviar.
  const commsWorker = new Worker(
    'communications.send',
    async (job) => {
      const data = job.data as { eventId?: string; template?: string } | undefined;
      logger.info(
        { jobId: job.id, eventId: data?.eventId, template: data?.template },
        'communications.send stub (TODO Fase 4: Resend idempotencyKey=eventId)',
      );
      return { stub: true };
    },
    { connection: createConnection() },
  );
  commsWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'communications.send falhou (stub)'));

  // --- Billing (Fase 4) -------------------------------------------------
  // `billing.webhook.apply`: envelope → POST interno idempotente na API
  // (TODO: `POST /v1/billing/internal/webhook-apply` com o envelope; hoje só
  // registra). Retry exp 5x + DLQ `billing.dlq` (replay manual, jobId=eventId).
  const billingWebhookWorker = new Worker(
    BILLING_QUEUES.webhookApply,
    async (job) =>
      handleBillingWebhookJob(
        { id: job.id, data: job.data, attemptsMade: job.attemptsMade },
        {
          applyEnvelope: async (envelope) => {
            logger.info(
              { eventId: envelope.eventId, topic: envelope.topic },
              'billing.webhook.apply recebido (TODO: aplicar via API interna idempotente)',
            );
          },
          moveToDlq: async (jobId, data, reason) => {
            await billingDlqQueue.add('dlq', data, { jobId });
            logger.warn({ jobId, eventId: data.eventId, reason }, 'billing.webhook.apply → DLQ');
          },
        },
      ),
    { connection: createConnection(), concurrency: 5 },
  );
  billingWebhookWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'billing.webhook.apply falhou'),
  );

  // `billing.recon`: tick hourly/daily (Asaas Sandbox-first; TODO: paginar a
  // API real com cursor + comparar externalId→status; hoje só registra).
  const billingReconWorker = new Worker(
    BILLING_QUEUES.recon,
    async (job) => {
      const out = await runReconTick({
        listPending: async () => [],
        fetchRemote: async () => null,
        emitSynthetic: async (eventId) => {
          logger.info({ eventId }, 'billing.recon sintético (TODO: outbox + fila)');
        },
        alert: async (detail) => logger.warn({ detail }, 'billing.recon divergência (TODO: alerta+e-mail admin)'),
        notifyAdmin: async () => undefined,
      });
      logger.info({ window: (job.data as { window?: string })?.window, ...out }, 'billing.recon tick ok');
      return out;
    },
    { connection: createConnection() },
  );
  billingReconWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, err }, 'billing.recon falhou (retry pelo BullMQ)'),
  );

  // `billing.fanout`: PaymentConfirmed → access/licensing/finance/notifications
  // (stubs com TODO; `communications.send` recebe o e-mail com
  // idempotencyKey=eventId — TODO Resend).
  const billingFanoutWorker = new Worker(
    BILLING_QUEUES.fanout,
    async (job) => {
      const data = job.data as { eventId?: string; topic?: string; payload?: unknown } | undefined;
      const env = {
        eventId: String(data?.eventId ?? job.id ?? 'sem-eventid'),
        topic: String(data?.topic ?? PAYMENT_CONFIRMED_TOPIC),
        payload: data?.payload,
      };
      const result = await fanOutPaymentConfirmed(env, {
        // Fase 5: finance real — enfileira em `finance.sync` com
        // `jobId = eventId` (o consumidor API é idempotente por eventId).
        toFinance: async (e) => {
          await financeSyncQueue.add(
            String(e.topic),
            { eventId: e.eventId, topic: e.topic, payload: (e.payload ?? {}) as Record<string, unknown> },
            financeSyncJobOptions(e.eventId),
          );
        },
        toNotifications: async (e) => {
          await commsQueue.add('send', {
            eventId: e.eventId,
            template: 'payment-confirmed',
            templateVersion: 1,
            idempotencyKey: e.eventId,
          }, { jobId: e.eventId });
        },
      });
      logger.info({ eventId: env.eventId, result }, 'billing.fanout ok');
      return result;
    },
    { connection: createConnection(), concurrency: 5 },
  );
  billingFanoutWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, err }, 'billing.fanout falhou (retry pelo BullMQ)'),
  );

  // --- Finance (Fase 5) -----------------------------------------------------
  // `finance.sync`: envelope do outbox billing → POST interno idempotente
  // na API (`POST /v1/finance/internal/sync`, guard `x-internal-key`).
  // Retry exp 5x + DLQ `finance.dlq` (replay manual, jobId=eventId).
  const financeInternalKey = process.env.INTERNAL_WEBHOOK_KEY ?? '';
  if (!financeInternalKey) {
    logger.warn('finance.sync sem INTERNAL_WEBHOOK_KEY (applies falharão p/ DLQ)');
  }
  const financeSyncWorker = new Worker(
    FINANCE_QUEUES.sync,
    async (job) =>
      handleFinanceSyncJob(
        { id: job.id, data: job.data, attemptsMade: job.attemptsMade },
        {
          apiBaseUrl: env.API_BASE_URL,
          internalKey: financeInternalKey,
          moveToDlq: async (jobId, data, reason) => {
            await financeDlqQueue.add('dlq', data, { jobId });
            logger.warn({ jobId, eventId: data.eventId, reason }, 'finance.sync → DLQ');
          },
        },
      ),
    { connection: createConnection(), concurrency: 5 },
  );
  financeSyncWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'finance.sync falhou'),
  );

  // --- Automação financeira (despesas via Asaas + receitas automáticas) ----
  // `finance.bill-pay` / `finance.auto-charge`: payload do job-data →
  // POST interno idempotente na API (replay DONE/SCHEDULED/CANCELED vira
  // duplicate sem retry). Retry exp 5x + DLQ `finance.dlq` (jobId original
  // preservado p/ replay manual).
  const financeAutomationDlq = async (jobId: string, data: Record<string, unknown>, reason: string) => {
    await financeDlqQueue.add('dlq', data, { jobId });
    logger.warn({ jobId, reason }, 'finance.automation → DLQ');
  };
  const financeBillPayWorker = new Worker(
    FINANCE_BILL_PAY_QUEUE,
    async (job) =>
      handleFinanceAutomationJob(
        { id: job.id, data: job.data, attemptsMade: job.attemptsMade },
        {
          apiBaseUrl: env.API_BASE_URL,
          internalKey: financeInternalKey,
          endpoint: FINANCE_BILL_PAY_ENDPOINT,
          moveToDlq: financeAutomationDlq,
        },
      ),
    { connection: createConnection(), concurrency: 3 },
  );
  financeBillPayWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'finance.bill-pay falhou'),
  );
  const financeAutoChargeWorker = new Worker(
    FINANCE_AUTO_CHARGE_QUEUE,
    async (job) =>
      handleFinanceAutomationJob(
        { id: job.id, data: job.data, attemptsMade: job.attemptsMade },
        {
          apiBaseUrl: env.API_BASE_URL,
          internalKey: financeInternalKey,
          endpoint: FINANCE_AUTO_CHARGE_ENDPOINT,
          moveToDlq: financeAutomationDlq,
        },
      ),
    { connection: createConnection(), concurrency: 3 },
  );
  financeAutoChargeWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'finance.auto-charge falhou'),
  );

  // --- Projeções (Fase 5) ---------------------------------------------------
  // `finance.projection.compute`: job (scope/refDate/tz/premisesHash) → POST
  // interno idempotente na API (`POST /v1/finance/projections/internal/compute`,
  // guard `x-internal-key`). Retry exp 5x + DLQ `finance.dlq` (replay manual,
  // jobId = scope:ref:hash preservado).
  const financeProjectionWorker = new Worker(
    FINANCE_PROJECTION_QUEUE,
    async (job) =>
      handleFinanceProjectionJob(
        { id: job.id, data: job.data, attemptsMade: job.attemptsMade },
        {
          apiBaseUrl: env.API_BASE_URL,
          // Chave interna dedicada quando configurada (INTERNAL_PROJECTION_KEY),
          // senão a compartilhada do pipeline (INTERNAL_WEBHOOK_KEY).
          internalKey: process.env.INTERNAL_PROJECTION_KEY ?? financeInternalKey,
          moveToDlq: async (jobId, data, reason) => {
            await financeDlqQueue.add('dlq', data, { jobId });
            financeMetrics.inc('finance.projection.dlq');
            logger.warn({ jobId, data, reason }, 'finance.projection.compute → DLQ');
          },
        },
      ),
    { connection: createConnection(), concurrency: 2 },
  );
  financeProjectionWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'finance.projection.compute falhou'),
  );

  // Ticker de invalidação de snapshots (safety net; a invalidação primária é
  // por evento via `POST .../internal/transaction-posted` a cada
  // FinanceTransactionPosted). Roda sem fila dedicada (setInterval + unref,
  // mesmo padrão do outbox.relay): erro só loga, o próximo tick retenta.
  const projectionInvalidationTick = async (): Promise<void> => {
    try {
      const out = await runProjectionInvalidationTick({
        apiBaseUrl: env.API_BASE_URL,
        internalKey: financeInternalKey,
      });
      financeMetrics.inc('finance.projection.invalidated', out.invalidated);
      logger.debug({ ...out }, 'finance.projection invalidation tick ok');
    } catch (err) {
      logger.error({ err }, 'finance.projection invalidation tick falhou');
    }
  };
  const projectionTimer = setInterval(() => {
    void projectionInvalidationTick().catch((err) => logger.error({ err }, 'finance.projection tick falhou'));
  }, PROJECTION_INVALIDATION_MS);
  projectionTimer.unref?.();

  // Relay Outbox por domínio (billing + existentes): ticker que drena
  // `outbox_events` (claim 100 FOR UPDATE SKIP LOCKED, jobId=eventId, marca
  // published). TODO: injetar Pool PG por domínio (DATABASE_URL_*) — hoje o
  // tick roda vazio para não publicar fantasma; ver RUNBOOK billing §5.
  // Purge 30d: TODO job agendado (nunca ad-hoc).
  const relayTick = async (): Promise<void> => {
    const out = await runOutboxRelayTick(
      OUTBOX_RELAY_DOMAINS.map((domain) => ({
        domain,
        db: { query: async () => ({ rowCount: 0, rows: [] }) },
        queue: { add: async () => ({}) },
      })),
    );
    logger.debug({ ...out }, 'outbox.relay tick (TODO: pools reais por domínio)');
  };
  const relayTimer = setInterval(() => {
    void relayTick().catch((err) => logger.error({ err }, 'outbox.relay tick falhou'));
  }, 30_000);
  relayTimer.unref?.();

  logger.info(
    {
      queues: [
        LICENSING_QUEUES.evaluate,
        LICENSING_QUEUES.sync,
        LICENSING_QUEUES.dlq,
        'communications.send',
        BILLING_QUEUES.webhookApply,
        BILLING_QUEUES.recon,
        BILLING_QUEUES.fanout,
        BILLING_QUEUES.dlq,
        FINANCE_QUEUES.sync,
        FINANCE_BILL_PAY_QUEUE,
        FINANCE_AUTO_CHARGE_QUEUE,
        FINANCE_PROJECTION_QUEUE,
        FINANCE_QUEUES.dlq,
      ],
    },
    'workers ready (licensing + billing + comms-stub + finance-sync + finance-projection + finance-automation)',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'workers shutdown');
    clearInterval(relayTimer);
    clearInterval(projectionTimer);
    await Promise.allSettled([
      evaluateWorker.close(),
      syncWorker.close(),
      commsWorker.close(),
      billingWebhookWorker.close(),
      billingReconWorker.close(),
      billingFanoutWorker.close(),
      financeSyncWorker.close(),
      financeBillPayWorker.close(),
      financeAutoChargeWorker.close(),
      financeProjectionWorker.close(),
      evaluateQueue.close(),
      syncQueue.close(),
      dlqQueue.close(),
      commsQueue.close(),
      billingWebhookQueue.close(),
      billingReconQueue.close(),
      billingFanoutQueue.close(),
      billingDlqQueue.close(),
      financeSyncQueue.close(),
      financeBillPayQueue.close(),
      financeAutoChargeQueue.close(),
      financeProjectionQueue.close(),
      financeDlqQueue.close(),
    ]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((err) => {
  logger.fatal({ err }, 'workers boot failed');
  process.exit(1);
});
