import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CustomerScope } from '../../common/decorators/customer-scope.decorator';
import { RequireMfa, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateAutoReceivableDto, CreateExpenseDto } from './finance-automation.dto';
import { FinanceAutomationService } from './finance-automation.service';
import { FinanceNotificationsService } from './finance-notifications.service';
import { FinanceReadGuard } from './finance-read.guard';

// Automação financeira (Fase 5+, PROJECT.md §3/§5):
// - `POST /v1/finance/expenses` (admin, `Idempotency-Key`): cria a despesa e,
//   quando solicitado e suportado, paga via Asaas Bill Payments com
//   agendamento automático (vencido = imediato, regra Asaas).
// - `POST /v1/finance/receivables/auto` (admin, `Idempotency-Key`): cria o
//   recebível e emite a cobrança Asaas automaticamente (PIX/BOLETO).
// - `GET /v1/finance/notifications` + `POST .../:id/read`: sino in-system.
// Rotas novas (sem sobreposição com `FinanceController`/`FinanceFlowController`).
// Replay da mesma chave → 200 com o existente (nunca 409 — dedupe é o
// caminho esperado, PROJECT.md §5).
@CustomerScope()
@Controller('finance')
export class FinanceAutomationController {
  constructor(
    private readonly automation: FinanceAutomationService,
    private readonly notifications: FinanceNotificationsService,
  ) {}

  private orgOf(req: {
    financeOrg?: { id: string };
    org?: { id: string };
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  }): string {
    const fromQuery =
      (typeof req.query?.['orgId'] === 'string' ? (req.query['orgId'] as string) : null) ??
      (typeof req.query?.['org_id'] === 'string' ? (req.query['org_id'] as string) : null);
    const id =
      req.financeOrg?.id ?? req.org?.id ?? fromQuery ??
      (typeof req.body?.['orgId'] === 'string' ? (req.body['orgId'] as string) : null);
    if (typeof id !== 'string' || id.length === 0) {
      throw new BadRequestException({ code: 'ORG_REQUIRED', message: 'Organização não resolvida (x-org-id).' });
    }
    return id;
  }

  private keyOf(header?: string): string {
    const key = (header ?? '').trim();
    if (key.length < 8) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_REQUIRED', message: 'Idempotency-Key obrigatória (mín. 8 chars).' });
    }
    return key;
  }

  @Post('expenses')
  @UseGuards(RolesGuard, FinanceReadGuard)
  @Roles('finance.manage')
  @RequireMfa()
  createExpense(
    @Req() req: never,
    @Body() dto: CreateExpenseDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.automation.createExpense(this.orgOf(req as never), dto, this.keyOf(key));
  }

  @Get('expenses/:id/automation')
  @UseGuards(FinanceReadGuard)
  expenseAutomation(@Req() req: never, @Param('id') id: string) {
    return this.automation.getExpenseAutomation(this.orgOf(req as never), id);
  }

  @Post('receivables/auto')
  @UseGuards(RolesGuard, FinanceReadGuard)
  @Roles('finance.manage')
  @RequireMfa()
  createReceivableAuto(
    @Req() req: never,
    @Body() dto: CreateAutoReceivableDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.automation.createReceivableAuto(this.orgOf(req as never), dto, this.keyOf(key));
  }

  @Get('notifications')
  @UseGuards(FinanceReadGuard)
  listNotifications(
    @Req() req: never,
    @Query('unread_only') unreadOnly?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.list(this.orgOf(req as never), {
      unreadOnly: unreadOnly === 'true' || unreadOnly === '1',
      limit: limit != null ? Number(limit) || undefined : undefined,
    });
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  @UseGuards(FinanceReadGuard)
  markNotificationRead(@Req() req: never, @Param('id') id: string) {
    return this.notifications.markRead(this.orgOf(req as never), id);
  }
}
