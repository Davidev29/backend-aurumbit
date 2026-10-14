import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AdminStubGuard } from './admin.guard';
import { LicensingFlowService } from './licensing-flow.service';

// Leituras admin do BFF sobre o fluxo in-memory (`LicensesController`
// completo NÃO é registrado aqui de propósito: mesmas rotas do core PG
// `POST /:id/renew|revoke|reveal` — sombrearia o core).
// Só os GETs novos, sem colisão: `by-product/:productId` e `:id/history`
// têm 2 segmentos (core `GET :id` tem 1).
@Controller('licenses')
@UseGuards(AdminStubGuard)
export class LicenseQueryController {
  constructor(private readonly flow: LicensingFlowService) {}

  @Get('by-product/:productId')
  byProduct(@Param('productId') productId: string) {
    return this.flow.listByProduct(productId);
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.flow.getHistory(id);
  }
}
