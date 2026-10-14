import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminStubGuard } from './admin.guard';
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
  @UseGuards(AdminStubGuard)
  create(@Body() dto: CreateFeatureDto) {
    return this.features.createFeature(dto);
  }
}
