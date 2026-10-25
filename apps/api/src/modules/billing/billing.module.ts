import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BILLING_POOL, createBillingPool } from './billing-pool.provider';
import { BillingFlowController } from './billing-flow.controller';
import { BillingFlowService } from './billing-flow.service';
import { BillingOutboxRelayService } from './billing-outbox-relay.service';
import { BillingReconciliationCron } from './reconcile.cron';
import { BillingReconciliationService } from './reconcile.service';
import { BillingService } from './billing.service';

// Fase 4 — Billing core (cobrança Asaas sandbox-first por adaptador em
// libs/asaas-adapter; webhook controller em outro workstream).
// Pool PG próprio (DATABASE_URL_BILLING); sem acesso a outros domínios.
// Aditivo workstream workers/outbox (Fase 4): fluxo canônico Order→Payment +
// webhook mock + relay outbox (jobId=eventId). Núcleo acima preservado.
@Module({
  controllers: [BillingController, BillingFlowController],
  providers: [
    { provide: BILLING_POOL, useFactory: createBillingPool },
    BillingService,
    BillingFlowService,
    BillingOutboxRelayService,
    BillingReconciliationService,
    BillingReconciliationCron,
  ],
  exports: [BillingService, BillingFlowService, BillingReconciliationService],
})
export class BillingModule {}
