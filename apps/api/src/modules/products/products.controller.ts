import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AdminStubGuard } from './admin.guard';
import { CreatePlanDto, CreateProductDto, CreateVersionDto } from './dto';
import { PlansService } from './plans.service';
import { ProductsService } from './products.service';

// Catálogo público de produtos. Leitura aberta; escrita exige admin (stub x-role).
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly plans: PlansService,
  ) {}

  @Public()
  @Get()
  list() {
    return this.products.listProducts();
  }

  @Public()
  @Get(':code')
  detail(@Param('code') code: string) {
    return this.products.getProduct(code);
  }

  // Catálogo de cobranças (público): todas as linhas ACTIVE p/ enriquecer o BFF.
  @Public()
  @Get('plans/all')
  allPlans() {
    return this.plans.listPlans();
  }

  @Public()
  @Get(':code/plans')
  productPlans(@Param('code') code: string) {
    return this.plans.listPlans(code);
  }

  @Post()
  @UseGuards(AdminStubGuard)
  create(@Body() dto: CreateProductDto) {
    return this.products.createProduct(dto);
  }

  @Post(':code/versions')
  @UseGuards(AdminStubGuard)
  addVersion(@Param('code') code: string, @Body() dto: CreateVersionDto) {
    return this.products.addVersion(code, dto);
  }

  @Post(':code/archive')
  @UseGuards(AdminStubGuard)
  archive(@Param('code') code: string) {
    return this.products.archiveProduct(code);
  }

  // Alias consumido pelo BFF (change-price): nova linha de catálogo com o
  // productCode forçado pelo path (preço imutável — sem update).
  @Post(':code/plans')
  @UseGuards(AdminStubGuard)
  createPlan(@Param('code') code: string, @Body() dto: CreatePlanDto) {
    return this.plans.createPlan({ ...dto, productCode: code });
  }
}
