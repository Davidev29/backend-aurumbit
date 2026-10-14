// Reconciliação billing × Asaas (Fase 4, PROJECT.md §5).
// - hourly (pendentes <7d) + daily 03:00 America/Sao_Paulo (30d).
// - Pagina o Asaas (`listPayments`), compara `externalId → status/valor`,
//   cria evento sintético `RECONCILIATION` (`recon:<id>:<data>`) pelo MESMO
//   pipeline (fila `billing.webhook.apply`, `jobId = eventId`).
// - Divergência → alerta (warn estruturado; e-mail admin é do workstream
//   communications — sem Resend aqui) + métrica `billing.recon.*`.
// Não reescreve o billing core: lê `payments`, nunca muta pagamento.

import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { BILLING_POOL } from './billing-pool.provider';
import { WEBHOOK_QUEUE, WebhookQueuePort, webhookJobOptions } from './webhook.queue';
import {
  DAILY_WINDOW_DAYS,
  HOURLY_WINDOW_DAYS,
  dayOf,
  normalizeAsaasStatus,
  reconEventId,
  windowCutoff,
} from './reconcile.transitions';

export interface ReconSqlRunner {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }>;
}

export interface ReconMetrics {
  inc(
    name: 'billing.recon.checked' | 'billing.recon.diverged' | 'billing.recon.completed',
    by?: number,
  ): void;
}

class NoopReconMetrics implements ReconMetrics {
  inc(): void {
    /* módulo pode injetar o do core */
  }
}

export interface RemotePayment {
  id: string;
  status: string;
  valueCents: number;
}

/** Subconjunto da porta Asaas necessário à reconciliação (fakes em teste). */
export interface ReconcileAsaasPort {
  getPaymentStatus(paymentId: string): Promise<RemotePayment>;
  listPayments(params?: {
    offset?: number;
    limit?: number;
  }): Promise<{ data: RemotePayment[]; hasMore: boolean }>;
}

export const RECONCILE_ASAAS = 'BILLING_RECONCILE_ASAAS';

/** Default fail-fast: sem porta Asaas a reconciliação aborta (nunca silenciosa). */
export class MissingReconcileAsaasPort implements ReconcileAsaasPort {
  async getPaymentStatus(): Promise<RemotePayment> {
    throw new ServiceUnavailableException('reconciliação indisponível (porta Asaas não conectada)');
  }
  async listPayments(): Promise<{ data: RemotePayment[]; hasMore: boolean }> {
    throw new ServiceUnavailableException('reconciliação indisponível (porta Asaas não conectada)');
  }
}

export interface ReconRunOptions {
  now?: Date;
  windowDays?: number;
  localPageSize?: number;
  remotePageSize?: number;
}

export interface ReconSummary {
  windowDays: number;
  checked: number;
  reconciled: number;
  diverged: number;
  errors: number;
  remoteOnly: number;
}

interface LocalPending {
  id: string;
  externalId: string;
  status: string;
  amountCents: number;
}

const PENDING_LOCAL =
  `SELECT id, "externalId", status, "amountCents", "createdAt" FROM payments` +
  ` WHERE provider = 'ASAAS' AND status IN ('PENDING', 'FAILED') AND "createdAt" >= $1` +
  ` ORDER BY "createdAt" ASC LIMIT $2 OFFSET $3`;

@Injectable()
export class BillingReconciliationService {
  private readonly logger = new Logger(BillingReconciliationService.name);
  private metrics: ReconMetrics = new NoopReconMetrics();

  constructor(
    @Inject(BILLING_POOL) private readonly db: ReconSqlRunner,
    @Optional() @Inject(WEBHOOK_QUEUE) private readonly queue?: WebhookQueuePort,
    @Optional() @Inject(RECONCILE_ASAAS) private asaas?: ReconcileAsaasPort,
  ) {}

  withMetrics(metrics: ReconMetrics): this {
    this.metrics = metrics;
    return this;
  }

  withAsaasPort(port: ReconcileAsaasPort): this {
    this.asaas = port;
    return this;
  }

  async runOnce(opts: ReconRunOptions = {}): Promise<ReconSummary> {
    const now = opts.now ?? new Date();
    const windowDays = opts.windowDays ?? HOURLY_WINDOW_DAYS;
    const localPageSize = opts.localPageSize ?? 200;
    const remotePageSize = opts.remotePageSize ?? 100;
    if (!this.asaas)
      throw new ServiceUnavailableException(
        'reconciliação indisponível (porta Asaas não conectada)',
      );

    const cutoff = windowCutoff(now, windowDays);
    const summary: ReconSummary = {
      windowDays,
      checked: 0,
      reconciled: 0,
      diverged: 0,
      errors: 0,
      remoteOnly: 0,
    };

    // 1. Varre pendentes locais na janela (paginado).
    const seen = new Set<string>();
    for (let offset = 0; ; offset += localPageSize) {
      const { rows } = await this.db.query(PENDING_LOCAL, [cutoff, localPageSize, offset]);
      if (rows.length === 0) break;
      for (const row of rows) {
        const local: LocalPending = {
          id: String(row.id),
          externalId: String(row.externalId),
          status: String(row.status),
          amountCents: Number(row.amountCents),
        };
        seen.add(local.externalId);
        summary.checked += 1;
        this.metrics.inc('billing.recon.checked');
        try {
          const remote = await this.asaas.getPaymentStatus(local.externalId);
          // Decisão granular (valor × estado separados):
          // - valor divergente ou status remoto desconhecido → alerta.
          // - remoto terminal + local pendente → RECONCILIA (sintético).
          // - demais diferenças (ex. remoto antigo vs local terminal =
          //   fora de ordem) → alerta, nunca regride.
          const remoteNorm = normalizeAsaasStatus(remote.status);
          if (!remoteNorm) {
            this.diverge(local.externalId, [`status-remoto-desconhecido:${remote.status}`]);
            summary.diverged += 1;
          } else if (local.amountCents !== remote.valueCents) {
            this.diverge(local.externalId, [`valor:${local.amountCents}-vs-${remote.valueCents}`]);
            summary.diverged += 1;
          } else if (local.status === remoteNorm) {
            // em dia — nada a fazer
          } else if (
            (local.status === 'PENDING' || local.status === 'FAILED') &&
            (remoteNorm === 'CONFIRMED' || remoteNorm === 'REFUNDED')
          ) {
            await this.enqueueRecon(local.externalId, now, {
              status: remote.status,
              valueCents: remote.valueCents,
            });
            summary.reconciled += 1;
            this.metrics.inc('billing.recon.completed');
          } else {
            const terminal = local.status === 'CONFIRMED' || local.status === 'REFUNDED';
            this.diverge(
              local.externalId,
              terminal
                ? [`remoto-antigo:${remote.status}-vs-local-terminal:${local.status}`]
                : [`estado:${local.status}-vs-${remoteNorm}`],
            );
            summary.diverged += 1;
          }
        } catch (e) {
          summary.errors += 1;
          this.logger.warn(
            JSON.stringify({
              event: 'billing.recon.error',
              externalId: local.externalId,
              error: e instanceof Error ? e.message : String(e),
              at: now.toISOString(),
            }),
          );
        }
      }
      if (rows.length < localPageSize) break;
    }

    // 2. Pagina o Asaas p/ detectar cobranças sem pagamento local (divergência).
    try {
      for (let offset = 0; ; offset += remotePageSize) {
        const page = await this.asaas.listPayments({ offset, limit: remotePageSize });
        for (const remote of page.data) {
          if (!seen.has(remote.id)) {
            const { rows } = await this.db.query(
              `SELECT id FROM payments WHERE provider = 'ASAAS' AND "externalId" = $1`,
              [remote.id],
            );
            if (rows.length === 0) {
              this.diverge(remote.id, ['sem-payment-local']);
              summary.diverged += 1;
              summary.remoteOnly += 1;
            }
          }
        }
        if (!page.hasMore) break;
      }
    } catch (e) {
      summary.errors += 1;
      this.logger.warn(
        JSON.stringify({
          event: 'billing.recon.error',
          scope: 'remote-page',
          error: e instanceof Error ? e.message : String(e),
          at: now.toISOString(),
        }),
      );
    }
    return summary;
  }

  private async enqueueRecon(
    paymentExternalId: string,
    now: Date,
    remote?: { status: string; valueCents: number },
  ): Promise<void> {
    const eventId = reconEventId(paymentExternalId, dayOf(now));
    await this.queue?.add(
      'apply',
      {
        eventId,
        kind: 'reconciliation',
        externalId: paymentExternalId,
        remoteStatus: remote?.status,
        remoteAmountCents: remote?.valueCents,
        receivedAt: now.toISOString(),
      },
      webhookJobOptions(eventId),
    );
  }

  private diverge(externalId: string, divergences: string[]): void {
    // Alerta (e-mail admin vive no workstream communications — TODO fwd).
    this.logger.warn(
      JSON.stringify({
        event: 'billing.recon.diverged',
        externalId,
        divergences,
        at: new Date().toISOString(),
      }),
    );
    this.metrics.inc('billing.recon.diverged');
  }
}

export { DAILY_WINDOW_DAYS, HOURLY_WINDOW_DAYS };
