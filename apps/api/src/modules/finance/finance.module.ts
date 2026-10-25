import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FinanceAutomationController } from './finance-automation.controller';
import { FinanceAutomationInternalController } from './finance-automation.internal.controller';
import { FINANCE_AUTOMATION_PROVIDER, createFinanceAutomationProvider } from './finance-automation.provider';
import { FINANCE_AUTOMATION_QUEUE_PORT, createFinanceAutomationQueue } from './finance-automation.queue';
import { FinanceAutomationService } from './finance-automation.service';
import { FinanceNotificationsService } from './finance-notifications.service';
import { FinanceController } from './finance.controller';
import { FinanceFlowController } from './finance-flow.controller';
import { FinanceFlowService } from './finance-flow.service';
import { FinanceOutboxRelayService } from './finance-outbox-relay.service';
import { FinanceReadGuard } from './finance-read.guard';
import { FinanceService } from './finance.service';
import { FINANCE_POOL, createFinancePool } from './finance-pool.provider';
import { ProjectionsModule } from './projections.module';
import { FinanceSyncController } from './sync.controller';
import { FINANCE_SYNC_QUEUE_PORT, createFinanceSyncQueue } from './sync.queue';
import { FinanceSyncService } from './sync.service';

// Fase 5 — módulo finance mesclado (dois workstreams aditivos + stub Fase 1):
// - Núcleo finance org-scoped (PG): FinanceController + FinanceService +
//   FinanceReadGuard (PROJECT.md §3 — finance.read explícito).
// - Fluxo in-memory/hermético (e2e): FinanceFlowController +
//   FinanceFlowService (ingest PaymentConfirmed, baixas, grants, balance).
//   NOTA: ambos registram `@Controller('finance')` com rotas sobrepostas
//   — o primeiro registrado (FinanceController) atende no Express.
//   Sombreadas do flow (mortas em prod, vivas no e2e isolado): POST
//   receivables, POST receivables/:id/mark-received, POST payables,
//   POST payables/:id/mark-paid, GET transactions. Vivas só no flow:
//   ingest/payment-confirmed, balance, projections(+compute), grants,
//   audit, metrics. TODO(orquestrador): unificar a
//   superfície /v1/finance (núcleo PG canônico; flow como adaptador).
// - Projeções: ProjectionsModule (compute/store/queue próprios).
// - Sync billing→finance (PG, sem org — espelho por provider+externalId):
//   FinanceSyncController (interno `POST /v1/finance/internal/sync`) +
//   FinanceSyncService. Não reescreve billing core nem finance core.
// - Automação (despesas via Asaas Bill Payments + receitas via cobrança
//   automática + notificações in-system): FinanceAutomationController
//   (`POST /v1/finance/expenses`, `POST /v1/finance/receivables/auto`,
//   `GET /v1/finance/notifications`) + FinanceAutomationService (jobs
//   idempotentes `UNIQUE(idempotencyKey)`, provider fora de txn, retry via
//   throw) + FinanceNotificationsService (`UNIQUE(eventId)`).
// Pool PG próprio (DATABASE_URL_FINANCE); sem acesso a outros domínios.
@Module({
  imports: [AuditModule, ProjectionsModule],
  controllers: [FinanceController, FinanceFlowController, FinanceSyncController, FinanceAutomationController, FinanceAutomationInternalController],
  providers: [
    { provide: FINANCE_POOL, useFactory: createFinancePool },
    { provide: FINANCE_SYNC_QUEUE_PORT, useFactory: createFinanceSyncQueue },
    { provide: FINANCE_AUTOMATION_PROVIDER, useFactory: createFinanceAutomationProvider },
    { provide: FINANCE_AUTOMATION_QUEUE_PORT, useFactory: createFinanceAutomationQueue },
    FinanceReadGuard,
    FinanceService,
    FinanceFlowService,
    FinanceSyncService,
    FinanceAutomationService,
    FinanceNotificationsService,
    FinanceOutboxRelayService,
  ],
  exports: [FinanceService, FinanceFlowService, FinanceSyncService, FinanceAutomationService, FinanceNotificationsService, FinanceOutboxRelayService],
})
export class FinanceModule {}
