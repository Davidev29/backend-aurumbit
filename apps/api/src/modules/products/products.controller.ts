import { Body, Controller, Get, Param, Patch, Post, Put, UseFilters, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RequireMfa, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreatePlanDto, CreateProductDto, CreateVersionDto, ReplaceProductDto, UpdateProductDto } from './dto';
import { PlansService } from './plans.service';
import { ProductValidationPtBrFilter } from './product-validation.filter';
import { ProductsService } from './products.service';

// Catálogo público de produtos. Leitura aberta; escrita exige role `STAFF_ADMIN`
// no JWT + MFA step-up (@RequireMfa).
//
// O filtro traduz para pt-BR as mensagens do `ValidationPipe` (que vem em
// inglês) — ver `product-validation.filter.ts` para o porquê de ser local e
// não global.
@Controller('products')
@UseFilters(ProductValidationPtBrFilter)
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

  // Catálogo de cobranças (público): todas as linhas ACTIVE p/ enriquecer o BFF.
  // Declarado ANTES de ':code' — senão 'plans/all' casaria code='plans' (shadowing Express).
  @Public()
  @Get('plans/all')
  allPlans() {
    return this.plans.listPlans();
  }

  @Public()
  @Get(':code')
  detail(@Param('code') code: string) {
    return this.products.getProduct(code);
  }

  @Public()
  @Get(':code/plans')
  productPlans(@Param('code') code: string) {
    return this.plans.listPlans(code);
  }

  @Post()
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  create(@Body() dto: CreateProductDto) {
    return this.products.createProduct(dto);
  }

  @Post(':code/versions')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  addVersion(@Param('code') code: string, @Body() dto: CreateVersionDto) {
    return this.products.addVersion(code, dto);
  }

  @Post(':code/archive')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  archive(@Param('code') code: string) {
    return this.products.archiveProduct(code);
  }

  // Atualização PARCIAL: só o que vier no corpo muda. Idempotente; `code`,
  // `status` e preço não são campos deste verb (motivo no corpo do 4xx).
  @Patch(':code')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  update(@Param('code') code: string, @Body() dto: UpdateProductDto) {
    return this.products.updateProduct(code, dto);
  }

  // Substituição TOTAL: `name`, `slug`, `description`, `machinesAllowed`,
  // `platforms` e `deliveryMode` são todos obrigatórios (400 lista o que falta).
  @Put(':code')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  replace(@Param('code') code: string, @Body() dto: ReplaceProductDto) {
    return this.products.replaceProduct(code, dto);
  }

  // Alias consumido pelo BFF (change-price): nova linha de catálogo com o
  // productCode forçado pelo path (preço imutável — sem update).
  @Post(':code/plans')
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  createPlan(@Param('code') code: string, @Body() dto: CreatePlanDto) {
    return this.plans.createPlan({ ...dto, productCode: code });
  }
}
