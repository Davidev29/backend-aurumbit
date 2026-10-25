import { Module } from '@nestjs/common';
import { AccessAdminController } from './access-admin.controller';
import { AccessCheckService } from './access-check.service';
import { AccessEvaluatorService } from './access-evaluator.service';
import { ACCESS_POOL, createAccessPool } from './access-pool.provider';
import { AccessController } from './access.controller';
import { BonusService } from './bonus.service';
import { CheckAccessCacheService } from './check-access-cache.service';
import { ContractsService } from './contracts.service';

// Fase 2 — Access base. Sem LicenseDevice/offline-token (Fase 3), sem Asaas.
// Pool PG próprio (DATABASE_URL_ACCESS); sem acesso a outros domínios.
// RBAC real: RolesGuard (APP_GUARD global) + @Roles('STAFF_ADMIN') nas rotas de admin.
@Module({
  controllers: [AccessController, AccessAdminController],
  providers: [
    { provide: ACCESS_POOL, useFactory: createAccessPool },
    CheckAccessCacheService,
    AccessCheckService,
    ContractsService,
    BonusService,
    AccessEvaluatorService,
  ],
})
export class AccessModule {}
