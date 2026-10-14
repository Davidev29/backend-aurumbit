// Webhook Asaas (Fase 4, PROJECT.md §5 + REQUIREMENTS.md §3).
// - `POST /v1/billing/webhooks/asaas` (público, `@Public()` — o Asaas não
//   tem JWT; autentica via header `asaas-access-token` timing-safe + IP
//   allowlist TODO). Preserva `rawBody` (exige `rawBody: true` no
//   `NestFactory.create` — TODO(orquestrador) em `apps/api/src/main.ts`,
//   uma linha; sem ele cai p/ `JSON.stringify(body)` com warn).
// - `POST /v1/billing/webhooks/apply` (interno worker→API, `@Public()` +
//   `x-internal-key`): executa RECEIVED→VALIDATED→APPLIED. Sem a chave
//   interna configurada (`INTERNAL_WEBHOOK_KEY`) responde 503 fail-closed.

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { BillingWebhookService } from './webhook.service';
import { WEBHOOK_TOKEN_HEADER, extractClientIp } from './webhook.transitions';

function rawBodyOf(req: unknown, body: unknown): { raw: string; fromRaw: boolean } {
  const raw = (req as { rawBody?: unknown }).rawBody;
  if (typeof raw === 'string') return { raw, fromRaw: true };
  if (Buffer.isBuffer(raw)) return { raw: raw.toString('utf8'), fromRaw: true };
  return { raw: JSON.stringify(body ?? {}), fromRaw: false };
}

function checkInternalKey(req: unknown): void {
  const expected = process.env.INTERNAL_WEBHOOK_KEY ?? null;
  if (!expected) {
    throw new ServiceUnavailableException(
      'apply interno indisponível (INTERNAL_WEBHOOK_KEY não configurado)',
    );
  }
  const headers = (req as { headers?: Record<string, unknown> }).headers ?? {};
  const got = headers['x-internal-key'];
  const gotStr = Array.isArray(got) ? got[0] : got;
  if (typeof gotStr !== 'string' || gotStr !== expected) {
    // Comparação simples é suficiente aqui (segredo de 256 bits via env;
    // endpoint interno, não exposto ao Asaas). timing-safe vive no webhook público.
    throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Chave interna inválida.' });
  }
}

@Public()
@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(private readonly webhooks: BillingWebhookService) {}

  @Post('asaas')
  @HttpCode(200)
  async handleAsaas(
    @Req() req: unknown,
    @Body() body: unknown,
    @Headers(WEBHOOK_TOKEN_HEADER) token?: string,
  ): Promise<{ received: true; duplicate: boolean; eventId: string }> {
    const r = req as {
      headers?: Record<string, unknown>;
      ip?: string;
      socket?: { remoteAddress?: string };
      log?: { warn: (msg: string) => void };
    };
    const headerToken =
      token ??
      (typeof r.headers?.[WEBHOOK_TOKEN_HEADER] === 'string'
        ? (r.headers[WEBHOOK_TOKEN_HEADER] as string)
        : undefined);
    const { raw, fromRaw } = rawBodyOf(req, body);
    if (!fromRaw) {
      // Sem `rawBody: true` no bootstrap o Express já parseou; preservamos
      // o melhor-effort e seguimos (assinatura é token, não HMAC do corpo).
      (r.log as { warn?: (msg: string) => void } | undefined)?.warn?.(
        'webhook asaas sem rawBody (bootstrap sem rawBody:true)',
      );
    }
    const out = await this.webhooks.receive({
      rawBody: raw,
      body,
      tokenHeader: headerToken,
      ip: extractClientIp(r),
    });
    return { received: true, duplicate: out.duplicate, eventId: out.eventId };
  }

  @Post('apply')
  @HttpCode(200)
  async apply(@Req() req: unknown, @Body() body: { externalId?: string }): Promise<unknown> {
    checkInternalKey(req);
    const externalId = typeof body?.externalId === 'string' ? body.externalId : '';
    if (!externalId) return { applied: false, reason: 'externalId obrigatório' };
    return this.webhooks.applyReceipt(externalId);
  }

  @Post('recon-apply')
  @HttpCode(200)
  async reconApply(
    @Req() req: unknown,
    @Body() body: { paymentExternalId?: string; remoteStatus?: string; remoteAmountCents?: number },
  ): Promise<unknown> {
    checkInternalKey(req);
    const paymentExternalId =
      typeof body?.paymentExternalId === 'string' ? body.paymentExternalId : '';
    if (!paymentExternalId) return { reconciled: false, reason: 'paymentExternalId obrigatório' };
    return this.webhooks.applyRecon({
      paymentExternalId,
      remoteStatus: typeof body?.remoteStatus === 'string' ? body.remoteStatus : undefined,
      remoteAmountCents:
        typeof body?.remoteAmountCents === 'number' ? body.remoteAmountCents : undefined,
    });
  }
}
