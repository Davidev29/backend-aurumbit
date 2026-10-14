import { Module } from '@nestjs/common';
import { BillingWebhookModule } from './webhook.module';
import { BillingReconciliationCron } from './reconcile.cron';
import {
  BillingReconciliationService,
  MissingReconcileAsaasPort,
  RECONCILE_ASAAS,
} from './reconcile.service';

// Módulo da reconciliação (Fase 4). Reusa a fila do webhook module
// (mesmo pipeline: `billing.webhook.apply`, `jobId = eventId`).
// Porta Asaas default = fail-fast (`MissingReconcileAsaasPort`);
// TODO(orquestrador): prover `RECONCILE_ASAAS` real sobre
// `@aurum/asaas-adapter` (exige `tsconfig paths` p/ libs — hoje a API
// não importa libs, ver `auth/rate-limit.ts`) ou implementar o port
// HTTP aqui com `fetch` + `loadAsaasConfig`.
@Module({
  imports: [BillingWebhookModule],
  providers: [
    { provide: RECONCILE_ASAAS, useClass: MissingReconcileAsaasPort },
    BillingReconciliationService,
    BillingReconciliationCron,
  ],
  exports: [BillingReconciliationService, BillingReconciliationCron],
})
export class BillingReconcileModule {}
