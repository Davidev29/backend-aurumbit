import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller';
import { PlansController } from './plans.controller';
import { FeaturesService, PlansService } from './plans.service';
import {
  ProductImageFileController,
  ProductImagesController,
} from './product-images.controller';
import { ProductImagesService } from './product-images.service';
import { PRODUCTS_POOL, createProductsPool } from './products-pool.provider';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

// Fase 2 — Products base. Escrita admin via RBAC real (RolesGuard + @Roles('STAFF_ADMIN') + MFA).
// Pool PG próprio (DATABASE_URL_PRODUCTS); sem acesso a outros domínios.
// Galeria em disco: bytes em PRODUCT_IMAGES_DIR (fora do repo), metadados
// em `product_images` (db push; baseline de migrations TBD).
@Module({
  controllers: [
    ProductsController,
    ProductImagesController,
    ProductImageFileController,
    PlansController,
    FeaturesController,
  ],
  providers: [
    { provide: PRODUCTS_POOL, useFactory: createProductsPool },
    ProductsService,
    ProductImagesService,
    PlansService,
    FeaturesService,
  ],
  exports: [PRODUCTS_POOL],
})
export class ProductsModule {}
