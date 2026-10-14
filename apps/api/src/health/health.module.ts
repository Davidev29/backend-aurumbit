import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsController } from './metrics.controller';

@Module({
  controllers: [HealthController, MetricsController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor }],
})
export class HealthModule {}
