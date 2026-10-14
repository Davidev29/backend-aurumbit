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
import { AdminStubGuard } from '../access/admin.guard';
import {
  CreateAccountDto,
  CreateCategoryDto,
  CreatePayableDto,
  CreateReceivableDto,
  FinanceListQueryDto,
  MarkPaidDto,
  MarkReceivedDto,
  OverviewQueryDto,
  TransactionListQueryDto,
} from './finance.dto';
import { FinanceReadGuard } from './finance-read.guard';
import { FinanceService } from './finance.service';

// Finance core (Fase 5, PROJECT.md §3): /v1/finance, sempre escopado por
// organização (`x-org-id`).
// - Leitura (GETs): `finance.read` explícito (FinanceReadGuard — stub com
//   TODO RBAC real: RolesGuard + membership + audit).
// - Escrita (POSTs, baixas): `finance.manage` SÓ admin (AdminStubGuard +
//   TODO RBAC real). Admin implica leitura (o read guard aceita x-role).
// - `@CustomerScope()` engaja a cadeia real (membership) quando houver
//   JWT; sem usuário, o guard pula (passthrough) e vale o stub.
// - POSTs aceitam `Idempotency-Key` (replay retorna o existente).
// - Projections compute: OUTRO workstream — nenhum endpoint de cálculo aqui.
@CustomerScope()
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

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

  // -- Overview ------------------------------------------------------------

  @Get('overview')
  @UseGuards(FinanceReadGuard)
  overview(@Req() req: never, @Query() query: OverviewQueryDto) {
    return this.finance.overview(this.orgOf(req as never), query.from, query.to);
  }

  // -- Categories (leitura + criação) ----------------------------------------

  @Get('categories')
  @UseGuards(FinanceReadGuard)
  listCategories(@Req() req: never, @Query('active_only') _active?: string) {
    return this.finance.listCategories(this.orgOf(req as never));
  }

  @Get('categories/:id')
  @UseGuards(FinanceReadGuard)
  getCategory(@Req() req: never, @Param('id') id: string) {
    return this.finance.getCategory(this.orgOf(req as never), id);
  }

  @Post('categories')
  @UseGuards(AdminStubGuard, FinanceReadGuard)
  createCategory(@Req() req: never, @Body() dto: CreateCategoryDto) {
    return this.finance.createCategory(this.orgOf(req as never), dto);
  }

  // -- Accounts (leitura + criação) ------------------------------------------

  @Get('accounts')
  @UseGuards(FinanceReadGuard)
  listAccounts(@Req() req: never) {
    return this.finance.listAccounts(this.orgOf(req as never));
  }

  @Get('accounts/:id')
  @UseGuards(FinanceReadGuard)
  getAccount(@Req() req: never, @Param('id') id: string) {
    return this.finance.getAccount(this.orgOf(req as never), id);
  }

  @Post('accounts')
  @UseGuards(AdminStubGuard, FinanceReadGuard)
  createAccount(@Req() req: never, @Body() dto: CreateAccountDto) {
    return this.finance.createAccount(this.orgOf(req as never), dto);
  }

  // -- Receivables -----------------------------------------------------------

  @Get('receivables')
  @UseGuards(FinanceReadGuard)
  listReceivables(@Req() req: never, @Query() query: FinanceListQueryDto) {
    return this.finance.listReceivables(this.orgOf(req as never), {
      status: query.status,
      from: query.from,
      to: query.to,
      limit: query.limit,
    });
  }

  @Post('receivables')
  @UseGuards(AdminStubGuard, FinanceReadGuard)
  createReceivable(@Req() req: never, @Body() dto: CreateReceivableDto) {
    return this.finance.createReceivable(this.orgOf(req as never), dto);
  }

  @Post('receivables/:id/mark-received')
  @HttpCode(200)
  @UseGuards(AdminStubGuard, FinanceReadGuard)
  markReceived(
    @Req() req: never,
    @Param('id') id: string,
    @Body() dto: MarkReceivedDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.finance.markReceived(this.orgOf(req as never), id, dto, key || undefined);
  }

  // -- Payables ----------------------------------------------------------------

  @Get('payables')
  @UseGuards(FinanceReadGuard)
  listPayables(@Req() req: never, @Query() query: FinanceListQueryDto) {
    return this.finance.listPayables(this.orgOf(req as never), {
      status: query.status,
      from: query.from,
      to: query.to,
      limit: query.limit,
    });
  }

  @Post('payables')
  @UseGuards(AdminStubGuard, FinanceReadGuard)
  createPayable(@Req() req: never, @Body() dto: CreatePayableDto) {
    return this.finance.createPayable(this.orgOf(req as never), dto);
  }

  @Post('payables/:id/mark-paid')
  @HttpCode(200)
  @UseGuards(AdminStubGuard, FinanceReadGuard)
  markPaid(
    @Req() req: never,
    @Param('id') id: string,
    @Body() dto: MarkPaidDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.finance.markPaid(this.orgOf(req as never), id, dto, key || undefined);
  }

  // -- Transactions (extrato realizado) ----------------------------------------

  @Get('transactions')
  @UseGuards(FinanceReadGuard)
  listTransactions(@Req() req: never, @Query() query: TransactionListQueryDto) {
    return this.finance.listTransactions(this.orgOf(req as never), {
      accountId: query.accountId,
      kind: query.kind,
      from: query.from,
      to: query.to,
      limit: query.limit,
    });
  }
}
