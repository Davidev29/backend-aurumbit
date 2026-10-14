// Webhook Asaas: recepção (ack <2s) + aplicação (VALIDATED→APPLIED).
// Fase 4, PROJECT.md §5. Não reescreve o billing core: persiste só o
// `webhook_receipts` do domínio billing e delega o efeito de domínio
// (payment/invoice) ao `PaymentApplyPort` — o orquestrador conecta a
// implementação sobre `BillingService` (confirm/refund); sem ela, o
// receipt fica VALIDATED + alerta (reconciliação cobre o gap).
// Sem Resend aqui (comunicações é outro workstream): divergência vira
// warn estruturado (`billing.webhook.rejected`) + métrica.

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BILLING_POOL } from './billing-pool.provider';
import { normalizeAsaasStatus } from './reconcile.transitions';
import { WEBHOOK_QUEUE, WebhookQueuePort, webhookJobOptions } from './webhook.queue';
import {
  IllegalWebhookTransition,
  WEBHOOK_PROVIDER,
  assertWebhookTransition,
  buildWebhookEventId,
  buildWebhookExternalId,
  extractClientIp,
  isIpAllowed,
  isWebhookTerminal,
  parseAsaasWebhook,
  parseIpAllowlist,
  validateWebhookToken,
} from './webhook.transitions';

export interface WebhookSqlRunner {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }>;
}

/** Métricas `billing.webhook.*` (compatível estrutural c/ billing-metrics do core). */
export interface WebhookMetrics {
  inc(
    name:
      | 'billing.webhook.received'
      | 'billing.webhook.applied'
      | 'billing.webhook.duplicate'
      | 'billing.webhook.rejected',
  ): void;
}

class NoopWebhookMetrics implements WebhookMetrics {
  inc(): void {
    /* default sem backend; módulo pode injetar o do core */
  }
}

/** Alvo de pagamento derivado do evento (espelho de `paymentTargetForAsaasEvent` do core — manter alinhado). */
export function paymentTargetForEvent(event: string): 'CONFIRMED' | 'REFUNDED' | 'FAILED' | null {
  switch (event) {
    case 'PAYMENT_CONFIRMED':
    case 'PAYMENT_RECEIVED':
      return 'CONFIRMED';
    case 'PAYMENT_REFUNDED':
      return 'REFUNDED';
    case 'PAYMENT_OVERDUE':
    case 'PAYMENT_DELETED':
      return 'FAILED';
    default:
      return null;
  }
}

/** Efeito de domínio (outro workstream conecta via BillingService). */
export interface PaymentApplyPort {
  apply(input: {
    externalId: string;
    paymentId: string;
    event: string;
    target: 'CONFIRMED' | 'REFUNDED' | 'FAILED';
    payload: unknown;
  }): Promise<{ applied: true } | { pending: string }>;
}

export interface ReceiveInput {
  rawBody: string;
  body: unknown;
  tokenHeader: string | undefined;
  ip: string;
}

export interface ReceiveResult {
  duplicate: boolean;
  eventId: string;
  externalId: string;
}

export interface ReconApplyInput {
  paymentExternalId: string;
  remoteStatus?: string;
  remoteAmountCents?: number;
}

export type ReconApplyResult =
  { reconciled: true; eventId: string } | { reconciled: false; reason: string; eventId: string };

export type ApplyResult =
  | { status: 'APPLIED'; eventId: string }
  | { status: 'VALIDATED'; pending: string; eventId: string }
  | { status: 'REJECTED'; reason: string; eventId: string }
  | { status: 'APPLIED' | 'DUPLICATE'; duplicate: true; eventId: string };

const RECEIPT_INSERT =
  `INSERT INTO webhook_receipts (id, provider, "externalId", status, payload, "createdAt")` +
  ` VALUES ($1, $2, $3, 'RECEIVED', $4::jsonb, now())` +
  ` ON CONFLICT (provider, "externalId") DO NOTHING RETURNING id, status`;

@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);
  private metrics: WebhookMetrics = new NoopWebhookMetrics();
  private applyPort: PaymentApplyPort | null = null;

  constructor(
    @Inject(BILLING_POOL) private readonly db: WebhookSqlRunner,
    @Optional() @Inject(WEBHOOK_QUEUE) private readonly queue?: WebhookQueuePort,
  ) {}

  withMetrics(metrics: WebhookMetrics): this {
    this.metrics = metrics;
    return this;
  }

  withApplyPort(port: PaymentApplyPort): this {
    this.applyPort = port;
    return this;
  }

  /**
   * Caminho do request (budget <2s): valida token+IP, persiste RECEIVED
   * idempotente e enfileira. NUNCA chama o Asaas nem o domínio aqui.
   * Conflito `ON CONFLICT DO NOTHING` → `{ duplicate: true }` (200).
   */
  async receive(input: ReceiveInput): Promise<ReceiveResult> {
    const expected = process.env.ASAAS_WEBHOOK_SECRET ?? null;
    if (!expected) {
      throw new ServiceUnavailableException('webhook Asaas indisponível (segredo não configurado)');
    }
    if (!validateWebhookToken(input.tokenHeader, expected)) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Assinatura do webhook inválida.',
      });
    }
    const allowlist = parseIpAllowlist(process.env.ASAAS_IP_ALLOWLIST);
    if (allowlist.length === 0) {
      this.logger.warn(
        'webhook asaas sem ASAAS_IP_ALLOWLIST (sandbox): origem aceita pelo token; fixe os ranges em producao',
      );
    }
    if (!isIpAllowed(input.ip, allowlist)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Origem não permitida.' });
    }
    const parsed = parseAsaasWebhook(input.body);
    if (!parsed) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Payload Asaas sem event/id.',
      });
    }
    const externalId = buildWebhookExternalId(parsed.event, parsed.paymentId);
    const eventId = buildWebhookEventId(externalId);

    let payloadJson = '{}';
    try {
      payloadJson = JSON.stringify({ raw: input.rawBody.slice(0, 20_000), body: input.body });
    } catch {
      payloadJson = JSON.stringify({ raw: input.rawBody.slice(0, 20_000) });
    }
    const ins = await this.db.query(RECEIPT_INSERT, [
      randomUUID(),
      WEBHOOK_PROVIDER,
      externalId,
      payloadJson,
    ]);
    if ((ins.rowCount ?? 0) === 0) {
      this.metrics.inc('billing.webhook.duplicate');
      return { duplicate: true, eventId, externalId };
    }
    this.metrics.inc('billing.webhook.received');

    // Enqueue best-effort: falha NÃO quebra o ack (receipt persiste;
    // reconciliação/sweeper re-enfileira — TODO sweeper dedicado).
    try {
      await this.queue?.add(
        'apply',
        {
          eventId,
          kind: 'webhook',
          externalId,
          event: parsed.event,
          paymentId: parsed.paymentId,
          receivedAt: new Date().toISOString(),
        },
        webhookJobOptions(eventId),
      );
    } catch (e) {
      this.logger.warn(
        `webhook enqueue falhou (ack preservado): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return { duplicate: false, eventId, externalId };
  }

  /**
   * Transição explícita com guarda (usada pelo endpoint interno do worker
   * e pela reconciliação). Ilegal → lança `IllegalWebhookTransition`.
   */
  async transitionReceipt(externalId: string, from: string, to: string): Promise<boolean> {
    assertWebhookTransition(from, to);
    const r = await this.db.query(
      `UPDATE webhook_receipts SET status = $1 WHERE provider = $2 AND "externalId" = $3 AND status = $4`,
      [to, WEBHOOK_PROVIDER, externalId, from],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Aplicação (chamada pelo worker via `POST /v1/billing/webhooks/apply`):
   * RECEIVED→VALIDATED→APPLIED. Ilegal/desconhecido → REJECTED + alerta,
   * sem sobrescrever; replay de terminal → idempotente.
   */
  async applyReceipt(externalId: string): Promise<ApplyResult> {
    const { rows } = await this.db.query(
      `SELECT status, payload FROM webhook_receipts WHERE provider = $1 AND "externalId" = $2`,
      [WEBHOOK_PROVIDER, externalId],
    );
    if (rows.length === 0)
      throw new NotFoundException(`webhook receipt ${externalId} não encontrado`);
    const current = String(rows[0].status);
    const payload = rows[0].payload as { body?: unknown } | null;
    const eventId = buildWebhookEventId(externalId);

    if (isWebhookTerminal(current))
      return { status: current as 'APPLIED' | 'DUPLICATE', duplicate: true, eventId };

    try {
      assertWebhookTransition(current, 'VALIDATED');
    } catch (e) {
      return this.reject(
        externalId,
        current,
        e instanceof IllegalWebhookTransition ? e.message : String(e),
        eventId,
      );
    }
    const toValidated = await this.transitionReceipt(externalId, current, 'VALIDATED');
    if (!toValidated) {
      // Race: outro consumidor avançou — releitura idempotente.
      const { rows: again } = await this.db.query(
        `SELECT status FROM webhook_receipts WHERE provider = $1 AND "externalId" = $2`,
        [WEBHOOK_PROVIDER, externalId],
      );
      const st = String(again[0]?.status ?? current);
      if (isWebhookTerminal(st))
        return { status: st as 'APPLIED' | 'DUPLICATE', duplicate: true, eventId };
      return { status: 'VALIDATED', pending: 'race-validated-por-outro-consumidor', eventId };
    }

    const body = (payload as { body?: unknown } | null)?.body ?? payload;
    const parsed = parseAsaasWebhook(body);
    const event = parsed?.event;
    const target = event ? paymentTargetForEvent(event) : null;
    if (!event || !target || !parsed) {
      return this.reject(
        externalId,
        'VALIDATED',
        `evento Asaas desconhecido/sem identidade: ${String(event ?? 'ausente')}`,
        eventId,
      );
    }
    if (!this.applyPort) {
      this.logger.warn(
        JSON.stringify({
          event: 'billing.webhook.pending',
          externalId,
          paymentId: parsed.paymentId,
          reason: 'apply-não-conectado',
          at: new Date().toISOString(),
        }),
      );
      return {
        status: 'VALIDATED',
        pending: 'apply-não-conectado (TODO orquestrador: BillingService)',
        eventId,
      };
    }
    let applied: { applied: true } | { pending: string };
    try {
      applied = await this.applyPort.apply({
        externalId,
        paymentId: parsed.paymentId,
        event,
        target,
        payload: body,
      });
    } catch (e) {
      if (e instanceof IllegalWebhookTransition) {
        return this.reject(externalId, 'VALIDATED', e.message, eventId);
      }
      throw e; // transitório → 500 → worker retenta
    }
    if ('pending' in applied) {
      return { status: 'VALIDATED', pending: applied.pending, eventId };
    }
    try {
      assertWebhookTransition('VALIDATED', 'APPLIED');
    } catch (e) {
      return this.reject(
        externalId,
        'VALIDATED',
        e instanceof IllegalWebhookTransition ? e.message : String(e),
        eventId,
      );
    }
    await this.transitionReceipt(externalId, 'VALIDATED', 'APPLIED');
    this.metrics.inc('billing.webhook.applied');
    return { status: 'APPLIED', eventId };
  }

  /**
   * Aplicação do evento sintético `RECONCILIATION` (worker via
   * `POST /v1/billing/webhooks/recon-apply`, mesmo pipeline).
   * Idempotente: pagamento ausente/já-terminal/divergente-valor →
   * no-op com motivo (sem retry); só terminal-remoto sobre
   * PENDING/FAILED aciona o `PaymentApplyPort` (idempotente no core).
   */
  async applyRecon(input: ReconApplyInput): Promise<ReconApplyResult> {
    const eventId = `recon:${input.paymentExternalId}:${new Date().toISOString().slice(0, 10)}`;
    const { rows } = await this.db.query(
      `SELECT id, status, "amountCents" FROM payments WHERE provider = $1 AND "externalId" = $2`,
      [WEBHOOK_PROVIDER, input.paymentExternalId],
    );
    if (rows.length === 0) return { reconciled: false, reason: 'payment-ausente', eventId };
    const status = String(rows[0].status);
    if (status === 'CONFIRMED' || status === 'REFUNDED') {
      return { reconciled: false, reason: 'já-terminal', eventId };
    }
    if (input.remoteStatus == null)
      return { reconciled: false, reason: 'sem-snapshot-remoto', eventId };
    const target = normalizeAsaasStatus(input.remoteStatus);
    if (!target)
      return { reconciled: false, reason: `remoto-desconhecido:${input.remoteStatus}`, eventId };
    if (target === status) return { reconciled: false, reason: 'já-igual', eventId };
    if (
      input.remoteAmountCents != null &&
      Number(rows[0].amountCents) !== input.remoteAmountCents
    ) {
      this.logger.warn(
        JSON.stringify({
          event: 'billing.recon.diverged',
          externalId: input.paymentExternalId,
          divergences: [`valor:${rows[0].amountCents}-vs-${input.remoteAmountCents}`],
          at: new Date().toISOString(),
        }),
      );
      this.metrics.inc('billing.webhook.rejected');
      return { reconciled: false, reason: 'valor-divergente', eventId };
    }
    if (
      (target === 'CONFIRMED' || target === 'REFUNDED') &&
      (status === 'PENDING' || status === 'FAILED')
    ) {
      if (!this.applyPort) {
        return {
          reconciled: false,
          reason: 'apply-não-conectado (TODO orquestrador: BillingService)',
          eventId,
        };
      }
      const out = await this.applyPort.apply({
        externalId: input.paymentExternalId,
        paymentId: input.paymentExternalId,
        event: target === 'CONFIRMED' ? 'PAYMENT_CONFIRMED' : 'PAYMENT_REFUNDED',
        target,
        payload: { reconciliation: true, remoteStatus: input.remoteStatus },
      });
      if ('pending' in out) return { reconciled: false, reason: out.pending, eventId };
      this.metrics.inc('billing.webhook.applied');
      return { reconciled: true, eventId };
    }
    return { reconciled: false, reason: `sem-transição:${status}-vs-${target}`, eventId };
  }

  private async reject(
    externalId: string,
    from: string,
    reason: string,
    eventId: string,
  ): Promise<ApplyResult> {
    try {
      if (from === 'RECEIVED' || from === 'VALIDATED') {
        await this.db.query(
          `UPDATE webhook_receipts SET status = 'REJECTED' WHERE provider = $1 AND "externalId" = $2 AND status = $3`,
          [WEBHOOK_PROVIDER, externalId, from],
        );
      }
    } catch {
      // melhor esforço: o alerta abaixo é o que importa
    }
    this.logger.warn(
      JSON.stringify({
        event: 'billing.webhook.rejected',
        externalId,
        from,
        reason,
        at: new Date().toISOString(),
      }),
    );
    this.metrics.inc('billing.webhook.rejected');
    return { status: 'REJECTED', reason, eventId };
  }
}
