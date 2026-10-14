import { Module } from '@nestjs/common';
import { BILLING_POOL, createBillingPool } from './billing-pool.provider';
import { BillingWebhookController } from './webhook.controller';
import { WEBHOOK_QUEUE, createWebhookQueue } from './webhook.queue';
import { BillingWebhookService } from './webhook.service';

// Módulo do webhook Asaas (Fase 4). Standalone de propósito: o billing
// core (`BillingModule`, outro workstream) não é tocado.
// TODO(orquestrador): importar `BillingWebhookModule` no `AppModule`
// (1 linha) e habilitar `rawBody: true` no `NestFactory.create`
// (ver `webhook.controller.ts`). Pool: factory compartilhada do core;
// quando o core exportar `BILLING_POOL`, remover este provider local
// (hoje cria 2º Pool p/ o mesmo DB — aceitável e documentado).
@Module({
  controllers: [BillingWebhookController],
  providers: [
    { provide: BILLING_POOL, useFactory: createBillingPool },
    { provide: WEBHOOK_QUEUE, useFactory: createWebhookQueue },
    BillingWebhookService,
  ],
  exports: [BillingWebhookService, WEBHOOK_QUEUE, BILLING_POOL],
})
export class BillingWebhookModule {}
