import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { RequireMfa, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateFeatureDto } from './dto';
import { FeaturesService } from './plans.service';

@Controller('features')
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get()
  list(@Query('kind') kind?: string) {
    return this.features.listFeatures(kind);
  }

  @Post()
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  create(@Body() dto: CreateFeatureDto) {
    return this.features.createFeature(dto);
  }
}
