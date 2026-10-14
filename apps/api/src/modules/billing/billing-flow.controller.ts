import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AdminStubGuard } from '../access/admin.guard';
import { AsaasWebhookDto, CreateOrderDto } from './billing-flow.dto';
import { BillingFlowService } from './billing-flow.service';

// Superfície Fase 4 (arquivo NOVO; `billing.controller.ts` stub preservado,
// sem rotas — não reescrito).
// - Rotas admin exigem `x-role: admin` (stub, PROJECT.md §3).
// - `POST /webhooks/asaas` é PÚBLICA (Asaas não envia o stub): responde sempre
//   200 (duplicate/rejected inclusive) p/ não gerar retry inútil do provedor.
//   TODO(prod): validar assinatura/token do Asaas + rate-limit por IP.
@Controller('billing')
export class BillingFlowController {
  constructor(private readonly flow: BillingFlowService) {}

  @Post('orders')
  @UseGuards(AdminStubGuard)
  createOrder(@Body() dto: CreateOrderDto) {
    return this.flow.createOrder(dto);
  }

  @Post('orders/:id/invoices')
  @UseGuards(AdminStubGuard)
  @HttpCode(201)
  createInvoice(@Param('id') id: string) {
    return this.flow.createInvoice(id);
  }

  @Get('orders/:id')
  @UseGuards(AdminStubGuard)
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
  @UseGuards(AdminStubGuard)
  outbox() {
    return this.flow.listOutbox();
  }

  @Get('emails')
  @UseGuards(AdminStubGuard)
  emails() {
    return this.flow.listEmails();
  }

  @Get('license-hooks')
  @UseGuards(AdminStubGuard)
  licenseHooks() {
    return this.flow.listLicenseHooks();
  }

  @Get('receipts')
  @UseGuards(AdminStubGuard)
  receipts() {
    return this.flow.listReceipts();
  }

  @Get('alerts')
  @UseGuards(AdminStubGuard)
  alerts() {
    return this.flow.listAlerts();
  }

  @Get('metrics')
  @UseGuards(AdminStubGuard)
  metrics() {
    return this.flow.metrics.snapshot();
  }
}
