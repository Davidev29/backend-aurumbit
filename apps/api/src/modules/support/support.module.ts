import { Module } from '@nestjs/common';
import { GuardsModule } from '../../common/guards/guards.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

// Ponte de atendimento em tempo real (portal ↔ admin).
// Sem pool próprio: memória como fonte + persistência best-effort no pool
// communications (quando `DATABASE_URL_COMMUNICATIONS` + tabelas `chat_*`).
// `GuardsModule` (import): o controller verifica o Bearer staff manualmente
// nas rotas `@Public()` (o `JwtAuthGuard` global pula públicas sem preencher
// `request.user` — ver `support.controller.ts`).
@Module({
  imports: [GuardsModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
