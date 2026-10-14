import { Module } from '@nestjs/common';
import { RetentionCron } from './retention.cron';
import { RetentionMetrics } from './retention.metrics';

// Módulo retenção Fase 6 (aditivo). Sem rotas públicas; o tick diário é
// o `RetentionCron` (dry-run default + métricas `retention.*`).
@Module({
  providers: [RetentionCron, RetentionMetrics],
  exports: [RetentionCron, RetentionMetrics],
})
export class RetentionModule {}
