import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { RequireMfa, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { LicensingFlowService } from './licensing-flow.service';

// Leituras admin do BFF sobre o fluxo in-memory (`LicensesController`
// completo NÃO é registrado aqui de propósito: mesmas rotas do core PG
// `POST /:id/renew|revoke|reveal` — sombrearia o core).
// Só os GETs novos, sem colisão: `by-product/:productId` e `:id/history`
// têm 2 segmentos (core `GET :id` tem 1).
// Requer role `STAFF_ADMIN` no JWT.
@Controller('licenses')
@UseGuards(RolesGuard)
export class LicenseQueryController {
  constructor(private readonly flow: LicensingFlowService) {}

  @Get('by-product/:productId')
  @Roles('STAFF_ADMIN')
  byProduct(@Param('productId') productId: string) {
    return this.flow.listByProduct(productId);
  }

  @Get(':id/history')
  @Roles('STAFF_ADMIN')
  history(@Param('id') id: string) {
    return this.flow.getHistory(id);
  }
}
