import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { RequireMfa, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AsaasWebhookDto, CreateOrderDto } from './billing-flow.dto';
import { BillingFlowService } from './billing-flow.service';

// Superfície Fase 4 (arquivo NOVO; `billing.controller.ts` stub preservado,
// sem rotas — não reescrito).
// - Rotas admin exigem role `billing.manage` no JWT + MFA step-up em escritas.
// - `POST /webhooks/asaas-mock` é PÚBLICA mock/dev (Asaas não envia o stub):
//   responde sempre 200 p/ não gerar retry inútil do provedor.
//   TODO(prod): validar assinatura/token do Asaas + rate-limit por IP.
@Controller('billing')
export class BillingFlowController {
  constructor(private readonly flow: BillingFlowService) {}

  @Post('orders')
  @Roles('billing.manage')
  @RequireMfa()
  createOrder(@Body() dto: CreateOrderDto) {
    return this.flow.createOrder(dto);
  }

  @Post('orders/:id/invoices')
  @Roles('billing.manage')
  @RequireMfa()
  @HttpCode(201)
  createInvoice(@Param('id') id: string) {
    return this.flow.createInvoice(id);
  }

  @Get('orders/:id')
  @Roles('billing.manage')
  getOrder(@Param('id') id: string) {
    const order = this.flow.getOrder(id);
    if (!order) return { code: 'NOT_FOUND', message: `order ${id} não encontrada` };
    return order;
  }

  // Mock/dev do fluxo canônico (e2e + smoke). Rota canônica prod é
  // POST /v1/billing/webhooks/asaas (BillingWebhookController, idempotente).
  @Post('webhooks/asaas-mock')
  @HttpCode(200)
  webhook(@Body() dto: AsaasWebhookDto) {
    const { receipt } = this.flow.applyAsaasWebhook({
      event: dto.event,
      payment: {
        id: dto.payment?.id ?? '',
        value: dto.payment?.value,
        confirmedDate: dto.payment?.confirmedDate,
        dueDate: dto.payment?.dueDate,
      },
      version: dto.version,
      occurredAt: dto.occurredAt,
    });
    return { status: receipt.status, reason: receipt.reason, externalId: receipt.externalId };
  }

  @Get('outbox')
  @Roles('billing.manage')
  outbox() {
    return this.flow.listOutbox();
  }

  @Get('emails')
  @Roles('billing.manage')
  emails() {
    return this.flow.listEmails();
  }

  @Get('license-hooks')
  @Roles('billing.manage')
  licenseHooks() {
    return this.flow.listLicenseHooks();
  }

  @Get('receipts')
  @Roles('billing.manage')
  receipts() {
    return this.flow.listReceipts();
  }

  @Get('alerts')
  @Roles('billing.manage')
  alerts() {
    return this.flow.listAlerts();
  }

  @Get('metrics')
  @Roles('billing.manage')
  metrics() {
    return this.flow.metrics.snapshot();
  }
}
