import { Controller, Get, Post, Body, Query, Param, UseGuards, Headers, BadRequestException } from '@nestjs/common';
import { RequireMfa, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PromotionsService, CreatePromotionInput } from './promotions.service';

@Controller('promotions')
export class PromotionsController {
  constructor(private readonly service: PromotionsService) {}

  @Roles('STAFF_ADMIN')
  @RequireMfa()
  @Post()
  async create(@Body() body: any, @Headers('x-internal-key') _key?: string) {
    if (!body?.productId) throw new BadRequestException('productId obrigatório.');
    const input: CreatePromotionInput = {
      productId: String(body.productId),
      type: body.type === 'DISCOUNT' ? 'DISCOUNT' : 'BONUS',
      discountPercent: body.discountPercent,
      expiresInHours: body.expiresInHours ?? null,
      maxDevices: body.maxDevices,
      note: body.note ?? null,
      influencerName: body.influencerName ?? null,
      influencerPlatformUrl: body.influencerPlatformUrl ?? null,
      influencerSource: body.influencerSource ?? null,
      commissionPercent: body.commissionPercent,
    };
    return this.service.create(input);
  }

  @Get()
  async list(@Query('productId') productId?: string) {
    if (!productId) return [];
    return this.service.listByProduct(productId);
  }

  @Get('validate/:code')
  async validate(@Param('code') code: string) {
    return this.service.validateCode(decodeURIComponent(code));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }
}
