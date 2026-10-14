import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { EmailService } from './email.service';
import { parseResendWebhook, verifyResendWebhookSignature } from './resend-webhook';

// Webhook Resend — `POST /webhooks/resend` (fora do prefixo `/v1`; ver
// `main.ts` exclude). Atualiza `EmailMessage.status` p/ BOUNCED/COMPLAINED
// (e confirma SENT em `email.delivered`), com dedupe por id do evento
// (`WebhookReceipt` → 200 duplicate). Tipos sem efeito (opened/clicked)
// recebem 200 `ignored`. Corpo malformado recebe 200 `ignored` (não corrige
// com retry). Assinatura Svix exigida quando `RESEND_WEBHOOK_SECRET` está
// configurado; verificação usa os bytes crus quando o runtime os preserva
// (`req.rawBody`), senão `JSON.stringify(body)` como melhor esforço.
@Controller()
@Public()
export class CommunicationsController {
  constructor(private readonly email: EmailService) {}

  @Post('webhooks/resend')
  @HttpCode(200)
  async handleResendWebhook(@Req() req: Request, @Body() body: unknown): Promise<Record<string, unknown>> {
    const secret = process.env.RESEND_WEBHOOK_SECRET ?? '';
    const raw: string = typeof (req as unknown as { rawBody?: unknown }).rawBody === 'string'
      ? ((req as unknown as { rawBody: string }).rawBody as string)
      : JSON.stringify(body ?? {});
    if (secret) {
      const headers = {
        'svix-id': header(req, 'svix-id'),
        'svix-signature': header(req, 'svix-signature'),
        'svix-timestamp': header(req, 'svix-timestamp'),
      };
      if (!verifyResendWebhookSignature({ secret, payload: raw, headers })) {
        throw new UnauthorizedException('assinatura do webhook Resend inválida');
      }
    }

    const parsed = parseResendWebhook(body);
    if (!parsed.ok) return { ok: true, ignored: true, errors: parsed.errors };
    const { event } = parsed;
    if (!event.delivery) return { ok: true, ignored: true, type: event.type };
    if (!event.emailId) return { ok: true, ignored: true, reason: 'sem email_id', type: event.type };

    const receipt = await this.email.recordWebhookReceipt({
      externalId: event.webhookId,
      emailId: event.emailId,
      type: event.type,
    });
    if (!receipt.inserted) return { ok: true, duplicate: true, type: event.type };

    const target = event.delivery === 'DELIVERED' ? 'SENT' : event.delivery;
    const applied = await this.email.applyResendStatus(event.emailId, target);
    if (!applied.found) return { ok: true, unknownEmail: true, type: event.type };
    return { ok: true, status: target, updated: applied.updated, previous: applied.previous ?? null };
  }
}

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return typeof v === 'string' ? v : undefined;
}
