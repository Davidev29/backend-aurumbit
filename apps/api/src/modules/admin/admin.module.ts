import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DlqAdminGuard } from './dlq-admin.guard';
import { DlqAdminController } from './dlq.controller';

// Módulo admin-DLQ Fase 6 (aditivo; nome distinto do `AdminModule`
// de `/admin/queues` — sem tocar em nenhum módulo de domínio).
@Module({
  imports: [AuditModule],
  controllers: [DlqAdminController],
  providers: [DlqAdminGuard],
})
export class DlqAdminModule {}
