import { Module } from '@nestjs/common';
import { COMMUNICATIONS_POOL, createCommunicationsPool } from './communications-pool.provider';
import { CommunicationsController } from './communications.controller';
import { EmailService } from './email.service';

// Fase 4 — Communications (Resend + templates reais, PROJECT.md §§5-6).
// Rotas: `POST /webhooks/resend` (fora do `/v1`, ver main.ts).
// Envio/filas: handler puro `email-sender.worker.ts` + opções
// `comm.queues.ts` (consumo no boot dos workers, outro workstream);
// mapeamento domínio→e-mail em `email-consumer.ts` (stub se produtor ausente).
@Module({
  controllers: [CommunicationsController],
  providers: [{ provide: COMMUNICATIONS_POOL, useFactory: createCommunicationsPool }, EmailService],
  exports: [EmailService],
})
export class CommunicationsModule {}
