import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RequireMfa, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from '../audit/audit.service';
import {
  ComputeProjectionDto,
  CreatePayableDto,
  CreateReceivableDto,
  GrantFinanceReadDto,
  IngestPaymentConfirmedDto,
  MarkPaidDto,
  MarkReceivedDto,
} from './finance-flow.dto';
import { FinanceFlowService } from './finance-flow.service';
import { FinanceReadGuard } from './finance-read.guard';

// Superfície Fase 5 (arquivo NOVO; `finance.controller.ts` stub preservado,
// sem rotas — não reescrito).
// - Escritas admin exigem role `finance.manage` no JWT + MFA step-up.
// - Leituras (`balance`, `projections`) exigem `finance.read` escopado
//   (`FinanceReadGuard`).
// - Projeções: snapshot em cache → 200 HIT; ausente/expirado → 202 MISS
//   (`computing`; worker `finance.projection.compute` + `POST .../compute`).
@Controller('finance')
export class FinanceFlowController {
  constructor(
    private readonly flow: FinanceFlowService,
    private readonly audit: AuditService,
  ) {}

  @Post('ingest/payment-confirmed')
  @Roles('finance.manage')
  @RequireMfa()
  @HttpCode(201)
  ingest(@Body() dto: IngestPaymentConfirmedDto) {
    return this.flow.ingestPaymentConfirmed({
      eventId: dto.eventId,
      orgId: dto.orgId,
      externalId: dto.externalId,
      amountCents: dto.amountCents,
      paidAt: dto.paidAt,
    });
  }

  @Post('receivables')
  @Roles('finance.manage')
  @RequireMfa()
  @HttpCode(201)
  createReceivable(@Body() dto: CreateReceivableDto) {
    return this.flow.createReceivable({
      orgId: dto.orgId,
      amountCents: dto.amountCents,
      externalId: dto.externalId,
      kind: dto.kind,
      dueDate: dto.dueDate,
    });
  }

  @Post('receivables/:id/mark-received')
  @Roles('finance.manage')
  @RequireMfa()
  receive(@Param('id') id: string, @Body() dto: MarkReceivedDto) {
    return this.flow.markReceived(id, { paidAt: dto.paidAt, eventId: dto.eventId });
  }

  @Post('payables')
  @Roles('finance.manage')
  @RequireMfa()
  @HttpCode(201)
  createPayable(@Body() dto: CreatePayableDto) {
    return this.flow.createPayable({
      orgId: dto.orgId,
      amountCents: dto.amountCents,
      kind: dto.kind,
      dueDate: dto.dueDate,
    });
  }

  @Post('payables/:id/mark-paid')
  @Roles('finance.manage')
  @RequireMfa()
  pay(@Param('id') id: string, @Body() dto: MarkPaidDto) {
    return this.flow.markPaid(id, { paidAt: dto.paidAt, eventId: dto.eventId });
  }

  @Get('balance')
  @UseGuards(FinanceReadGuard)
  balance(@Query('orgId') orgId?: string, @Query('org_id') orgIdSnake?: string) {
    const org = String(orgId ?? orgIdSnake ?? '');
    return this.flow.getBalance(org);
  }

  @Get('projections')
  @UseGuards(FinanceReadGuard)
  projections(
    @Query('orgId') orgId?: string,
    @Query('org_id') orgIdSnake?: string,
    @Query('horizonDays') horizon?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const org = String(orgId ?? orgIdSnake ?? '');
    const horizonDays = Number(horizon ?? 30) || 30;
    const { hit, snapshot } = this.flow.peekProjection(org, horizonDays);
    if (hit && snapshot) return { cache: 'HIT', snapshot };
    // Miss: snapshot ausente/expirado → 202 COMPUTING (worker
    // `finance.projection.compute` + `POST .../compute`; polling no GET).
    res?.status(202);
    return { cache: 'MISS', status: 'COMPUTING', orgId: org, horizonDays };
  }

  @Post('projections/compute')
  @Roles('finance.manage')
  @RequireMfa()
  @HttpCode(201)
  compute(@Body() dto: ComputeProjectionDto) {
    return this.flow.computeProjection(dto.orgId, dto.horizonDays ?? 30);
  }

  @Post('grants')
  @Roles('finance.manage')
  @RequireMfa()
  @HttpCode(201)
  grant(@Body() dto: GrantFinanceReadDto) {
    return this.flow.grantRead({ orgId: dto.orgId, grantee: dto.grantee, reason: dto.reason, actorId: dto.actorId });
  }

  @Get('grants')
  @Roles('finance.manage')
  grants() {
    return this.flow.listGrants();
  }

  @Get('transactions')
  @Roles('finance.manage')
  transactions(@Query('orgId') orgId?: string) {
    return this.flow.listTransactions(orgId);
  }

  @Get('audit')
  @Roles('finance.manage')
  auditLog(@Query('action') action?: string) {
    if (action === 'finance.transaction.posted') return this.audit.list('finance.transaction.posted');
    if (action === 'finance.read.grant') return this.audit.list('finance.read.grant');
    return [...this.audit.list('finance.transaction.posted'), ...this.audit.list('finance.read.grant')];
  }

  @Get('metrics')
  @Roles('finance.manage')
  metrics() {
    return this.flow.metrics.snapshot();
  }
}
