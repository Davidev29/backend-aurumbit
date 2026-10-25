import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Public } from '../common/decorators/public.decorator';
import { RequireMfa, Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards/roles.guard';

// Stub Fase 6 — Bull Board em `/admin/queues` (raiz, fora do prefixo /v1).
// Admin-only (`RolesGuard` + `@Roles('STAFF_ADMIN')` + `@RequireMfa()`; identidade via JWT).
// Sem `@bull-board/*` de propósito (dep pesada adiada — ver docs/SLOs.md § Queues):
// responde o estado funcional (DLQ depth ao vivo do registry + TODO de wiring).
// Quando a dep entrar, este controller monta o `ExpressAdapter` do Bull Board
// atrás do mesmo guard, sem mudar path nem auth.
@Controller('admin/queues')
export class AdminQueuesController {
  // @Public marca para pular a cadeia global; o guard local impõe admin-only + MFA.
  @Public()
  @Get()
  @UseGuards(RolesGuard)
  @Roles('STAFF_ADMIN')
  @RequireMfa()
  overview(@Req() req: Request): Record<string, unknown> {
    const incoming = req.headers['x-correlation-id'];
    const correlationId =
      (Array.isArray(incoming) ? incoming[0] : incoming)?.trim() || randomUUID();
    return {
      status: 'stub',
      correlationId,
      queues: [
        { name: 'licensing.sync', dlq: 'licensing.dlq' },
        { name: 'billing.webhook.apply', dlq: 'billing.dlq' },
        { name: 'finance.sync', dlq: 'finance.dlq' },
        { name: 'finance.projection.compute', dlq: 'finance.dlq' },
        { name: 'comm.email.send', dlq: 'comm.dlq' },
      ],
      // TODO(Fase 6+): plugar Bull Board (`@bull-board/api` + `ExpressAdapter`)
      // neste path atrás do mesmo `AdminStubGuard`; expor `bullmq_dlq_depth`
      // via `setDlqDepth()` no tick do relay (ver libs/observability metrics).
      bullBoard: 'TODO — dep @bull-board/* adiada (pesada); este stub preserva path+auth',
      alerts: 'TODO — DLQ>0 → Slack/Pager (ver deploy/obs/alerts.yaml)',
    };
  }
}
