import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminStubGuard } from './admin.guard';
import { ArchivePlanDto, CreatePlanDto } from './dto';
import { PlansService } from './plans.service';

// Linhas de catálogo públicas. Preço imutável: existe create + archive,
// NENHUM endpoint de update de priceCents (nova linha p/ novo preço).
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list(@Query('productCode') productCode?: string, @Query('status') status?: string) {
    return this.plans.listPlans(productCode, status || 'ACTIVE');
  }

  @Get(':code')
  current(@Param('code') code: string) {
    return this.plans.getPlan(code);
  }

  @Post()
  @UseGuards(AdminStubGuard)
  create(@Body() dto: CreatePlanDto) {
    return this.plans.createPlan(dto);
  }

  @Post(':id/archive')
  @UseGuards(AdminStubGuard)
  archive(@Param('id') id: string, @Body() dto: ArchivePlanDto) {
    return this.plans.archivePlan(id, dto);
  }

  @Post(':id/activate')
  @UseGuards(AdminStubGuard)
  activate(@Param('id') id: string) {
    return this.plans.activatePlan(id);
  }
}
