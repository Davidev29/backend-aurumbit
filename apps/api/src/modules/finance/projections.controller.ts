/**
 * Projeções — rotas `/v1/finance/projections` (Fase 5).
 *
 * - GET `?scope=monthly|quarterly|annual&ref=YYYY-MM-DD&tz=America/Sao_Paulo`
 *   (`finance.read`): hit → 200; miss leve → 200 computado inline;
 *   miss pesado → 202 + jobId (polling em `GET jobs/:jobId`).
 * - POST `/recompute` (`finance.manage`): invalida + enfileira → 202.
 * - POST `/internal/compute` (x-internal-key): worker computa + upsert.
 * - POST `/internal/transaction-posted` (x-internal-key): evento
 *   FinanceTransactionPosted invalida snapshots do período.
 */

import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  FinanceProjectionsGuard,
  InternalProjectionKeyGuard,
  RequireFinanceScope,
} from './projections.guard';
import { ProjectionsService } from './projections.service';

@Controller('finance/projections')
@UseGuards(FinanceProjectionsGuard)
export class ProjectionsController {
  constructor(private readonly projections: ProjectionsService) {}

  @Get()
  @RequireFinanceScope('finance.read')
  async get(
    @Query('scope') scope: string,
    @Query('ref') ref: string | undefined,
    @Query('tz') tz: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.projections.getProjection({ scope, ref, tz });
    res.status(out.httpStatus);
    return out.body;
  }

  @Get('jobs/:jobId')
  @RequireFinanceScope('finance.read')
  getJob(@Param('jobId') jobId: string) {
    return this.projections.getJob(jobId);
  }

  @Post('recompute')
  @RequireFinanceScope('finance.manage')
  async recompute(
    @Body() body: { scope?: string; ref?: string; tz?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.projections.recompute(body ?? {});
    res.status(202);
    return { queued: true, ...out };
  }

  @Post('internal/compute')
  @UseGuards(InternalProjectionKeyGuard)
  async internalCompute(@Body() body: { scope: string; refDate: string; tz?: string }) {
    const snapshot = await this.projections.computeAndStore(
      body?.scope,
      body?.refDate,
      body?.tz ?? 'America/Sao_Paulo',
    );
    return { status: 'APPLIED', jobId: `${snapshot.scope}:${snapshot.refDate}:${snapshot.premisesHash}` };
  }

  @Post('internal/transaction-posted')
  @UseGuards(InternalProjectionKeyGuard)
  async internalTransactionPosted(@Body() body: { occurredAt: string }) {
    const out = await this.projections.handleTransactionPosted(body?.occurredAt);
    return { status: 'APPLIED', ...out };
  }
}
