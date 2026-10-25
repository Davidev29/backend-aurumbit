import { Module } from '@nestjs/common';
import { AUDIT_POOL, createAuditPool } from './audit-pool.provider';
import { AuditController } from './audit.controller';
import { AuditReadService } from './audit-read.service';
import { AuditService } from './audit.service';

// TODO(Fase 2): implementar domínio audit. Stub vazio criado em T2 Fase 1, sem regra de negócio.
// Fase 3 (aditivo): AuditService append-only em memória + AuditInterceptor
// (controller stub acima preservado).
// Leitura PG (aditivo): `GET /v1/audit/events` via AuditReadService sobre
// `audit.audit_events` (pool próprio DATABASE_URL_AUDIT, só SELECT).
// Nada escreve no PG hoje (ver relatório do workstream de leitura).
// RBAC real: RolesGuard (APP_GUARD global) + @Roles('STAFF_ADMIN') na rota de leitura.
@Module({
  controllers: [AuditController],
  providers: [
    { provide: AUDIT_POOL, useFactory: createAuditPool },
    AuditService,
    AuditReadService,
  ],
  exports: [AuditService, AuditReadService],
})
export class AuditModule {}
