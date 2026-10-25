import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AccessEvaluatorService } from './access-evaluator.service';
import { BonusService } from './bonus.service';
import { ContractsService } from './contracts.service';
import { RequireMfa, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CreateContractDto,
  GrantBonusDto,
  LogAdjustmentDto,
  RevokeBonusDto,
  UpdateContractStatusDto,
  UpdateItemStatusDto,
  UpsertEntitlementDto,
} from './dto';

// Superfície administrativa do acesso (RBAC real via JWT).
// Requer role `STAFF_ADMIN` no JWT; escritas exigem MFA step-up (@RequireMfa).
// Provisionamento de Entitlements por pagamento entra na Fase 4 (Billing).
@Controller('access')
@UseGuards(RolesGuard)
export class AccessAdminController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly bonus: BonusService,
    private readonly evaluator: AccessEvaluatorService,
  ) {}

  @Post('contracts')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  createContract(@Body() dto: CreateContractDto) {
    return this.contracts.createContract(dto);
  }

  @Get('contracts')
  @Roles('STAFF_ADMIN')
  listContracts(@Query('ownerType') ownerType?: string, @Query('ownerId') ownerId?: string) {
    return this.contracts.listContracts(ownerType, ownerId);
  }

  @Get('contracts/:id')
  @Roles('STAFF_ADMIN')
  getContract(@Param('id') id: string) {
    return this.contracts.getContract(id);
  }

  @Post('contracts/:id/status')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  updateContractStatus(@Param('id') id: string, @Body() dto: UpdateContractStatusDto) {
    return this.contracts.updateContractStatus(id, dto);
  }

  @Post('contracts/:contractId/items/:itemId/status')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  updateItemStatus(
    @Param('contractId') contractId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemStatusDto,
  ) {
    return this.contracts.updateItemStatus(contractId, itemId, dto);
  }

  @Get('entitlements')
  @Roles('STAFF_ADMIN')
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
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  upsertEntitlement(@Body() dto: UpsertEntitlementDto) {
    return this.contracts.upsertEntitlement(dto);
  }

  @Post('bonus')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  grantBonus(@Body() dto: GrantBonusDto) {
    return this.bonus.grantBonus(dto);
  }

  @Post('bonus/:id/revoke')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  revokeBonus(@Param('id') id: string, @Body() dto: RevokeBonusDto) {
    return this.bonus.revokeBonus(id, dto);
  }

  @Post('adjustments')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  logAdjustment(@Body() dto: LogAdjustmentDto) {
    return this.bonus.logAdjustment(dto);
  }

  @Get('adjustments')
  @Roles('STAFF_ADMIN')
  listAdjustments(@Query('targetType') targetType?: string, @Query('targetId') targetId?: string) {
    return this.bonus.listAdjustments(targetType, targetId);
  }

  // Gatilho manual do avaliador (o agendamento BullMQ 5min entra nos workers).
  @Post('admin/evaluate')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  evaluate() {
    return this.evaluator.evaluate();
  }
}
