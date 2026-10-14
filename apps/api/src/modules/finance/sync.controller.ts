// Endpoint interno worker→API do sync billing→finance (Fase 5).
// `POST /v1/finance/internal/sync` (interno, `@Public()` + `x-internal-key`):
// recebe o envelope do outbox billing e aplica via FinanceSyncService
// (idempotente por eventId). Sem a chave interna (`INTERNAL_WEBHOOK_KEY`,
// compartilhada com o pipeline billing) responde 503 fail-closed.
// Replay/duplicado → 200 `{ duplicate: true }` (nunca 409: dedupe é o
// caminho esperado, PROJECT.md §5 — `jobId = eventId` no BullMQ).

import { Body, Controller, HttpCode, Post, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { FinanceSyncService, type FinanceEnvelope } from './sync.service';

function checkInternalKey(req: unknown): void {
  const expected = process.env.INTERNAL_WEBHOOK_KEY ?? null;
  if (!expected) {
    throw new ServiceUnavailableException(
      'sync interno indisponível (INTERNAL_WEBHOOK_KEY não configurado)',
    );
  }
  const headers = (req as { headers?: Record<string, unknown> }).headers ?? {};
  const got = headers['x-internal-key'];
  const gotStr = Array.isArray(got) ? got[0] : got;
  if (typeof gotStr !== 'string' || gotStr !== expected) {
    throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Chave interna inválida.' });
  }
}

@Public()
@Controller('finance/internal')
export class FinanceSyncController {
  constructor(private readonly sync: FinanceSyncService) {}

  @Post('sync')
  @HttpCode(200)
  async syncEnvelope(@Req() req: unknown, @Body() body: FinanceEnvelope): Promise<unknown> {
    checkInternalKey(req);
    const eventId = typeof body?.eventId === 'string' ? body.eventId : '';
    if (!eventId) return { applied: false, reason: 'eventId obrigatório' };
    return this.sync.handleEnvelope(body);
  }
}
