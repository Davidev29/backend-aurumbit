// Agendamento da reconciliação (Fase 4, PROJECT.md §5).
// - hourly: pendentes <7d (`RECONCILE_SCHEDULE.hourly`).
// - daily: 03:00 America/Sao_Paulo, janela 30d (`RECONCILE_SCHEDULE.daily`).
// Sem nova dependência (`@nestjs/schedule` não instalado): timers nativos
// com `unref()`; `onModuleInit` só agenda com `RECONCILE_CRON_ENABLED=1`
// (testes/e2e chamam `runHourly`/`runDaily` direto — determinístico).
// TODO(orquestrador): setar `RECONCILE_CRON_ENABLED=1` no deploy da API
// (uma réplica) ou mover p/ ticker dos workers (repeat BullMQ).

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BillingReconciliationService, ReconSummary } from './reconcile.service';
import {
  DAILY_WINDOW_DAYS,
  HOURLY_WINDOW_DAYS,
  RECONCILE_SCHEDULE,
  msUntilNextDaily3hSP,
} from './reconcile.transitions';

export const HOURLY_INTERVAL_MS = 60 * 60 * 1000;
export const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BillingReconciliationCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingReconciliationCron.name);
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private destroyed = false;

  constructor(private readonly recon: BillingReconciliationService) {}

  /** tick hourly (<7d pendentes). */
  async runHourly(now: Date = new Date()): Promise<ReconSummary> {
    const out = await this.recon.runOnce({ now, windowDays: HOURLY_WINDOW_DAYS });
    this.logger.log(
      JSON.stringify({ event: 'billing.recon.hourly', ...out, at: now.toISOString() }),
    );
    return out;
  }

  /** tick daily 03:00 SP (30d). */
  async runDaily(now: Date = new Date()): Promise<ReconSummary> {
    const out = await this.recon.runOnce({ now, windowDays: DAILY_WINDOW_DAYS });
    this.logger.log(
      JSON.stringify({ event: 'billing.recon.daily', ...out, at: now.toISOString() }),
    );
    return out;
  }

  onModuleInit(): void {
    if (process.env.RECONCILE_CRON_ENABLED !== '1') return;
    const hourly = setInterval(() => {
      this.runHourly().catch((e) =>
        this.logger.error(`recon hourly falhou: ${e instanceof Error ? e.message : String(e)}`),
      );
    }, HOURLY_INTERVAL_MS);
    hourly.unref?.();
    this.timers.push(hourly);

    const armDaily = (): void => {
      if (this.destroyed) return;
      const wait = msUntilNextDaily3hSP(new Date());
      const t = setTimeout(() => {
        this.runDaily()
          .catch((e) =>
            this.logger.error(`recon daily falhou: ${e instanceof Error ? e.message : String(e)}`),
          )
          .finally(armDaily);
      }, wait);
      t.unref?.();
      this.timers.push(t);
    };
    armDaily();
    this.logger.log(
      JSON.stringify({ event: 'billing.recon.cron.armed', schedule: RECONCILE_SCHEDULE }),
    );
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    for (const t of this.timers) {
      clearInterval(t as unknown as NodeJS.Timeout);
      clearTimeout(t as unknown as NodeJS.Timeout);
    }
    this.timers = [];
  }
}
