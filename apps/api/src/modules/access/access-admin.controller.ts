import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AccessEvaluatorService } from './access-evaluator.service';
import { AdminStubGuard } from './admin.guard';
import { BonusService } from './bonus.service';
import { ContractsService } from './contracts.service';
import {
  CreateContractDto,
  GrantBonusDto,
  LogAdjustmentDto,
  RevokeBonusDto,
  UpdateContractStatusDto,
  UpdateItemStatusDto,
  UpsertEntitlementDto,
} from './dto';

// Superfície administrativa do acesso (stub x-role: admin; TODO RBAC real).
// Provisionamento de Entitlements por pagamento entra na Fase 4 (Billing).
@Controller('access')
@UseGuards(AdminStubGuard)
export class AccessAdminController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly bonus: BonusService,
    private readonly evaluator: AccessEvaluatorService,
  ) {}

  @Post('contracts')
  createContract(@Body() dto: CreateContractDto) {
    return this.contracts.createContract(dto);
  }

  @Get('contracts')
  listContracts(@Query('ownerType') ownerType?: string, @Query('ownerId') ownerId?: string) {
    return this.contracts.listContracts(ownerType, ownerId);
  }

  @Get('contracts/:id')
  getContract(@Param('id') id: string) {
    return this.contracts.getContract(id);
  }

  @Post('contracts/:id/status')
  updateContractStatus(@Param('id') id: string, @Body() dto: UpdateContractStatusDto) {
    return this.contracts.updateContractStatus(id, dto);
  }

  @Post('contracts/:contractId/items/:itemId/status')
  updateItemStatus(
    @Param('contractId') contractId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemStatusDto,
  ) {
    return this.contracts.updateItemStatus(contractId, itemId, dto);
  }

  @Get('entitlements')
  listEntitlements(
    @Query('ownerType') ownerType?: string,
    @Query('ownerId') ownerId?: string,
    @Query('productId') productId?: string,
    @Query('featureCode') featureCode?: string,
    @Query('status') status?: string,
  ) {
    return this.contracts.listEntitlements({ ownerType, ownerId, productId, featureCode, status });
  }

  @Post('entitlements')
  upsertEntitlement(@Body() dto: UpsertEntitlementDto) {
    return this.contracts.upsertEntitlement(dto);
  }

  @Post('bonus')
  grantBonus(@Body() dto: GrantBonusDto) {
    return this.bonus.grantBonus(dto);
  }

  @Post('bonus/:id/revoke')
  revokeBonus(@Param('id') id: string, @Body() dto: RevokeBonusDto) {
    return this.bonus.revokeBonus(id, dto);
  }

  @Post('adjustments')
  logAdjustment(@Body() dto: LogAdjustmentDto) {
    return this.bonus.logAdjustment(dto);
  }

  @Get('adjustments')
  listAdjustments(@Query('targetType') targetType?: string, @Query('targetId') targetId?: string) {
    return this.bonus.listAdjustments(targetType, targetId);
  }

  // Gatilho manual do avaliador (o agendamento BullMQ 5min entra nos workers).
  @Post('admin/evaluate')
  evaluate() {
    return this.evaluator.evaluate();
  }
}
