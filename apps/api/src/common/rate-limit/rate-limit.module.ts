import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GlobalRateLimitGuard } from './global-rate-limit.guard';

// Enforcement global Fase 6 (aditivo). Registrado como APP_GUARD —
// importado ANTES de `GuardsModule` no `AppModule` para proteger
// login/recovery/webhook antes da cadeia de auth (brute-force não
// espera 401). Só age nos 4 prefixos; resto = allow.
@Module({
  providers: [{ provide: APP_GUARD, useClass: GlobalRateLimitGuard }],
})
export class RateLimitModule {}
