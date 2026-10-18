import { Module } from '@nestjs/common';
import { COMMUNICATIONS_POOL, createCommunicationsPool } from './communications-pool.provider';
import { AUTH_POOL, getSharedAuthPool } from '../auth/auth-pool.provider';
import { CommunicationsController } from './communications.controller';
import { EmailService } from './email.service';
import { AuthEmailRelayService } from './auth-email-relay.service';

// Fase 4 — Communications (Resend + templates reais, PROJECT.md §§5-6).
// Rotas: `POST /webhooks/resend` (fora do `/v1`, ver main.ts).
// Envio/filas: handler puro `email-sender.worker.ts` + opções
// `comm.queues.ts` (consumo no boot dos workers, outro workstream);
// mapeamento domínio→e-mail em `email-consumer.ts` (stub se produtor ausente).
@Module({
  controllers: [CommunicationsController],
  providers: [
    { provide: COMMUNICATIONS_POOL, useFactory: createCommunicationsPool },
    { provide: AUTH_POOL, useFactory: getSharedAuthPool },
    EmailService,
    AuthEmailRelayService,
  ],
  exports: [EmailService, AuthEmailRelayService],
})
export class CommunicationsModule {}
