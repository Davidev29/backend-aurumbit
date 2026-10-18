import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../common/auth/jwt-payload';
import { AdminStubGuard } from '../access/admin.guard';
import {
  CancelDto,
  CheckoutOrderDto,
  ConfirmPaymentDto,
  CreateInvoiceDto,
  CreateRefundDto,
  CreateSubscriptionDto,
  RegisterPaymentDto,
  SyncCustomerDto,
} from './billing.dto';
import { ListInvoicesQueryDto, ListSubscriptionsQueryDto } from './billing-list.dto';
import { BillingService } from './billing.service';

// Billing core (Fase 4, PROJECT.md §5): /v1/billing. POSTs aceitam
// `Idempotency-Key` (replay retorna o existente, sem duplicar).
// Webhook Asaas (RECEIVED→VALIDATED→APPLIED): outro workstream — este
// controller expõe só o núcleo de cobrança + hooks de aplicação.
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('customers/sync')
  @HttpCode(200)
  syncCustomer(@Body() dto: SyncCustomerDto) {
    return this.billing.syncCustomer(dto);
  }

  /**
   * Leitura espelho do titular p/ telas admin (nome/e-mail). Sem PII sensível.
   */
  @Get('customers/:userId')
  @UseGuards(AdminStubGuard)
  getCustomer(@Param('userId') userId: string) {
    return this.billing.getCustomer(userId);
  }

  @Post('invoices')
  createInvoice(@Body() dto: CreateInvoiceDto, @Headers('idempotency-key') key?: string) {
    return this.billing.createInvoice(dto, key || undefined);
  }

  @Get('invoices')
  @UseGuards(AdminStubGuard)
  listInvoices(@Query() q: ListInvoicesQueryDto) {
    return this.billing.listInvoices({
      status: q.status,
      dueFrom: q.dueFrom,
      dueTo: q.dueTo,
      limit: q.limit,
      cursor: q.cursor,
    });
  }

  @Get('invoices/mine')
  getMyInvoices(@CurrentUser() user?: AuthPrincipal) {
    if (!user?.identityId) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Não autenticado.' });
    return this.billing.listMyInvoices(user.identityId);
  }

  @Get('subscriptions/mine')
  getMySubscriptions(@CurrentUser() user?: AuthPrincipal) {
    if (!user?.identityId) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Não autenticado.' });
    return this.billing.listMySubscriptions(user.identityId);
  }

  @Get('invoices/:id')
  getInvoice(@Param('id') id: string) {
    return this.billing.getInvoice(id);
  }

  @Get('invoices/:id/payments')
  @UseGuards(AdminStubGuard)
  listInvoicePayments(@Param('id') id: string) {
    return this.billing.listInvoicePayments(id);
  }

  /**
   * Emissão (DRAFT → PENDING) p/ telas admin — sem ela a fatura nunca sai
   * do rascunho. Idempotente (PENDING repetido retorna a linha).
   */
  @Post('invoices/:id/emit')
  @UseGuards(AdminStubGuard)
  emitInvoice(@Param('id') id: string) {
    return this.billing.emitInvoice(id);
  }

  @Post('invoices/:id/cancel')
  cancelInvoice(@Param('id') id: string, @Body() dto: CancelDto) {
    return this.billing.cancelInvoice(id, dto);
  }

  @Post('subscriptions')
  createSubscription(@Body() dto: CreateSubscriptionDto, @Headers('idempotency-key') key?: string) {
    return this.billing.createSubscription(dto, key || undefined);
  }

  @Get('subscriptions')
  @UseGuards(AdminStubGuard)
  listSubscriptions(@Query() q: ListSubscriptionsQueryDto) {
    return this.billing.listSubscriptions({ status: q.status, limit: q.limit, cursor: q.cursor });
  }

  @Get('subscriptions/:id')
  getSubscription(@Param('id') id: string) {
    return this.billing.getSubscription(id);
  }

  /**
   * Ativação (DRAFT → ACTIVE) p/ telas admin e seed. Idempotente.
   */
  @Post('subscriptions/:id/activate')
  @UseGuards(AdminStubGuard)
  activateSubscription(@Param('id') id: string) {
    return this.billing.activateSubscription(id);
  }

  @Post('subscriptions/:id/cancel')
  cancelSubscription(@Param('id') id: string, @Body() dto: CancelDto) {
    return this.billing.cancelSubscription(id, dto);
  }

  @Post('payments')
  registerPayment(@Body() dto: RegisterPaymentDto, @Headers('idempotency-key') key?: string) {
    return this.billing.registerPayment(dto, key || undefined);
  }

  @Get('payments/:id')
  getPayment(@Param('id') id: string) {
    return this.billing.getPayment(id);
  }

  // Hook de aplicação (provider/webhook/reconciliação informam a
  // confirmação; emite outbox PaymentConfirmed — lado access/licensing
  // fora deste módulo).
  @Post('payments/:id/confirm')
  confirmPayment(@Param('id') id: string, @Body() dto: ConfirmPaymentDto) {
    return this.billing.confirmPayment(id, dto);
  }

  @Post('payments/:id/refund')
  createRefund(
    @Param('id') id: string,
    @Body() dto: CreateRefundDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.billing.createRefund(id, dto, key || undefined);
  }

  @Get('refunds/:id')
  getRefund(@Param('id') id: string) {
    return this.billing.getRefund(id);
  }

  /**
   * Checkout pós-pagamento real (Fase 8): cria invoice PENDING idempotente
   * por orderId e devolve a sessão PENDING. Nunca `done` — a licença nasce
   * no PaymentConfirmed (lado licensing). O portal faz polling em
   * `GET checkout/:orderId` até PAID + licença.
   */
  @Post('checkout')
  @HttpCode(201)
  createCheckout(@Body() dto: CheckoutOrderDto, @Headers('idempotency-key') idempotencyKey?: string) {
    // orderId é a chave primária de idempotência (UNIQUE); o header
    // Idempotency-Key (repassado pelo BFF) fica registrado na assinatura para
    // observabilidade e uso futuro — replay do mesmo orderId retorna a sessão.
    void idempotencyKey;
    return this.billing.createCheckoutOrder(dto);
  }

  @Get('checkout/:orderId')
  getCheckout(@Param('orderId') orderId: string) {
    return this.billing.getCheckoutOrder(orderId);
  }

  /**
   * Contexto p/ issue-from-payment (Fase 8, interno worker→API, `@Public()` +
   * `x-internal-key` — mesmo padrão do apply). Sem a chave → 503 fail-closed.
   */
  @Public()
  @Get('internal/issue-context/:paymentId')
  getIssueContext(@Param('paymentId') paymentId: string, @Headers('x-internal-key') key?: string) {
    const expected = process.env.INTERNAL_WEBHOOK_KEY ?? null;
    if (!expected) {
      throw new ServiceUnavailableException(
        'contexto interno indisponível (INTERNAL_WEBHOOK_KEY não configurado)',
      );
    }
    if (typeof key !== 'string' || key !== expected) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Chave interna inválida.' });
    }
    return this.billing.getIssueContext(paymentId);
  }
}
