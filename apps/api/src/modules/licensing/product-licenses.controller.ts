import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RequireMfa, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  LICENSE_EFFECTIVE_STATUSES,
  LicensesService,
  MaskedLicense,
} from './licenses.service';

/**
 * `GET /v1/products/:code/licenses` — estado ATUAL das licenças do produto.
 *
 * Por que existe: o histórico (`/v1/licenses/:id/history`) responde "o que
 * aconteceu com esta chave"; este endpoint responde "como estão as chaves
 * deste produto agora". O modal de produto do admin precisa das duas e só
 * tinha a primeira — daí chaves vencidas aparecerem como "Ativa".
 *
 * `code` é a referência opaca cross-schema gravada em
 * `licenses.productId` na emissão (o code do produto, não o id do catálogo
 * de products — domínios separados, sem FK). Mesma chave usada por
 * `GET /v1/licenses?productId=`.
 *
 * GUARDA: `RolesGuard` + `@Roles('STAFF_ADMIN')`, mesma política dos demais
 * endpoints admin do licensing (`licensing.controller.ts`).
 *
 * ROTA: `products/:code/licenses` tem 3 segmentos com 2º literal fixo
 * (`licenses`) — não colide com `products/:code/plans` nem
 * `products/plans/all` (ProductsModule, 2º literal distinto) nem com
 * `products/:code` (2 segmentos).
 */
class ProductLicensesQueryDto {
  /** Teto duro: a listagem é uma visão de produto, não um dump. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  /**
   * Status EFETIVO (active|grace|expired|suspended|revoked|pending_payment).
   * Filtra NO SQL (ver `statusSqlPredicate`) e reconfirma em JS — a página
   * nunca vem com item de status diferente do pedido.
   */
  @IsOptional()
  @IsIn(LICENSE_EFFECTIVE_STATUSES as unknown as string[])
  status?: string;
}

@Controller('products')
@UseGuards(RolesGuard)
export class ProductLicensesController {
  constructor(private readonly licenses: LicensesService) {}

  @Get(':code/licenses')
  @Roles('STAFF_ADMIN')
  list(
    @Param('code') code: string,
    @Query() q: ProductLicensesQueryDto,
  ): Promise<{
    items: MaskedLicense[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }> {
    return this.licenses.listProductLicenses(code, {
      limit: q.limit,
      offset: q.offset,
      status: q.status,
    });
  }
}
