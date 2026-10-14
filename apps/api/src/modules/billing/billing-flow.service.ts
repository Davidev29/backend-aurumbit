import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BillingMetrics } from './billing-metrics';
import {
  AsaasWebhookPayload,
  assertPaymentTransition,
  isOutOfOrderRegression,
  isTerminalPayment,
  outboxTypeForPaymentStatus,
  paymentConfirmedEventId,
  paymentTargetForAsaasEvent,
  reconEventId,
} from './billing-transitions';

// Fluxo canônico de faturamento (Fase 4, PROJECT.md §§5-6). In-memory +
// hermético (e2e sem PG/Redis); adaptador PG sobre `billing.*` segue o mesmo
// contrato (UNIQUE(provider,externalId), ON CONFLICT DO NOTHING → duplicate).
//
// NÃO reescreve webhook/comms existentes: este serviço é o dono do fluxo
// Order → Invoice → Payment + webhook Asaas (mock Sandbox-first) + outbox
// `PaymentConfirmed` + hook de licença (TODO worker) + e-mail stub.
// - `PaymentConfirmed` exige `paidAt + amount` casando (divergência → REJECTED).
// - Replay do mesmo webhook → DUPLICATE (200), sem duplicar licença/e-mail.
// - Transição ilegal → REJECTED + alerta, sem sobrescrever o pagamento.
// - `idempotencyKey = eventId` no e-mail stub (Resend real é TODO Fase 4+).

export const BILLING_PROVIDER = 'ASAAS';

export interface OrderRecord {
  id: string;
  customerId: string;
  productId: string;
  amountCents: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  invoiceId: string;
  paymentId: string;
  createdAt: string;
}

export interface InvoiceRecord {
  id: string;
  orderId: string;
  externalId: string;
  amountCents: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  createdAt: string;
}

export interface PaymentRecord {
  id: string;
  provider: string;
  externalId: string;
  customerId: string;
  orderId: string;
  amountCents: number;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  paidAt: string | null;
  updatedAt: string;
}

export interface WebhookReceiptRecord {
  id: string;
  provider: string;
  externalId: string;
  event: string;
  status: 'RECEIVED' | 'VALIDATED' | 'APPLIED' | 'REJECTED' | 'DUPLICATE';
  reason: string | null;
  createdAt: string;
}

export interface OutboxRecord {
  eventId: string;
  aggregate: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface EmailStub {
  idempotencyKey: string;
  template: string;
  templateVersion: number;
  to: string;
  eventId: string;
  enqueuedAt: string;
}

export interface LicenseHookCall {
  eventId: string;
  orderId: string;
  paymentId: string;
  action: string;
  appliedAt: string;
}

@Injectable()
export class BillingFlowService {
  private readonly orders = new Map<string, OrderRecord>();
  private readonly invoices = new Map<string, InvoiceRecord>();
  private readonly payments = new Map<string, PaymentRecord>(); // key provider:externalId
  private readonly paymentsById = new Map<string, PaymentRecord>();
  private readonly receipts: WebhookReceiptRecord[] = [];
  private readonly seen = new Set<string>(); // provider:externalId:event (dedupe entrega)
  private readonly outbox: OutboxRecord[] = [];
  private readonly outboxIds = new Set<string>();
  private readonly emails: EmailStub[] = [];
  private readonly emailKeys = new Set<string>();
  private readonly licenseHooks: LicenseHookCall[] = [];
  private readonly alerts: Array<{ kind: string; detail: string; at: string }> = [];
  readonly metrics = new BillingMetrics();

  private key(provider: string, externalId: string): string {
    return `${provider}:${externalId}`;
  }

  // --- order / invoice (pending) ------------------------------------------

  createOrder(input: { customerId: string; productId: string; amountCents: number }): {
    order: OrderRecord;
    invoice: InvoiceRecord;
    payment: PaymentRecord;
  } {
    const orderId = randomUUID();
    const externalId = `pay_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = new Date().toISOString();
    const payment: PaymentRecord = {
      id: randomUUID(),
      provider: BILLING_PROVIDER,
      externalId,
      customerId: input.customerId,
      orderId,
      amountCents: input.amountCents,
      status: 'PENDING',
      paidAt: null,
      updatedAt: now,
    };
    const invoice: InvoiceRecord = {
      id: randomUUID(),
      orderId,
      externalId,
      amountCents: input.amountCents,
      status: 'PENDING',
      createdAt: now,
    };
    const order: OrderRecord = {
      id: orderId,
      customerId: input.customerId,
      productId: input.productId,
      amountCents: input.amountCents,
      status: 'PENDING',
      invoiceId: invoice.id,
      paymentId: payment.id,
      createdAt: now,
    };
    this.orders.set(order.id, order);
    this.invoices.set(invoice.id, invoice);
    this.payments.set(this.key(payment.provider, payment.externalId), payment);
    this.paymentsById.set(payment.id, payment);
    return { order, invoice, payment };
  }

  createInvoice(orderId: string): InvoiceRecord {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`order ${orderId} não encontrada`);
    const existing = this.invoices.get(order.invoiceId);
    if (existing) return existing; // idempotente: uma invoice pendente por order
    const now = new Date().toISOString();
    const payment = this.paymentsById.get(order.paymentId);
    const invoice: InvoiceRecord = {
      id: randomUUID(),
      orderId,
      externalId: payment?.externalId ?? `pay_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      amountCents: order.amountCents,
      status: 'PENDING',
      createdAt: now,
    };
    this.invoices.set(invoice.id, invoice);
    order.invoiceId = invoice.id;
    return invoice;
  }

  getPayment(id: string): PaymentRecord | undefined {
    return this.paymentsById.get(id);
  }

  getOrder(id: string): { order: OrderRecord; invoice: InvoiceRecord; payment: PaymentRecord } | undefined {
    const order = this.orders.get(id);
    if (!order) return undefined;
    const invoice = this.invoices.get(order.invoiceId);
    const payment = this.paymentsById.get(order.paymentId);
    if (!invoice || !payment) return undefined;
    return { order, invoice, payment };
  }

  listOutbox(): OutboxRecord[] {
    return [...this.outbox];
  }

  listEmails(): EmailStub[] {
    return [...this.emails];
  }

  listLicenseHooks(): LicenseHookCall[] {
    return [...this.licenseHooks];
  }

  listReceipts(): WebhookReceiptRecord[] {
    return [...this.receipts];
  }

  listAlerts(): Array<{ kind: string; detail: string; at: string }> {
    return [...this.alerts];
  }

  private alert(kind: string, detail: string): void {
    this.alerts.push({ kind, detail, at: new Date().toISOString() });
  }

  private emitOutbox(row: OutboxRecord): boolean {
    if (this.outboxIds.has(row.eventId)) return false; // UNIQUE(eventId)
    this.outboxIds.add(row.eventId);
    this.outbox.push(row);
    return true;
  }

  private enqueueEmail(stub: EmailStub): boolean {
    if (this.emailKeys.has(stub.idempotencyKey)) return false; // idempotencyKey=eventId
    this.emailKeys.add(stub.idempotencyKey);
    this.emails.push(stub);
    return true;
  }

  // --- webhook Asaas (mock Sandbox-first) -----------------------------------
  // TODO(prod): validar assinatura/token do Asaas antes de RECEIVED
  // (hoje o mock é aceito direto; produção exige HMAC + allowlist de IP).

  applyAsaasWebhook(payload: AsaasWebhookPayload): { http: 200; receipt: WebhookReceiptRecord } {
    const provider = BILLING_PROVIDER;
    const externalId = payload?.payment?.id ?? '';
    const event = String(payload?.event ?? '');
    this.metrics.inc('billing.webhook.received');
    const receipt: WebhookReceiptRecord = {
      id: randomUUID(),
      provider,
      externalId,
      event,
      status: 'RECEIVED',
      reason: null,
      createdAt: new Date().toISOString(),
    };

    // 1. Dedupe de entrega: ON CONFLICT(provider, externalId, event) DO NOTHING.
    const deliveryKey = `${this.key(provider, externalId)}:${event}`;
    if (this.seen.has(deliveryKey)) {
      receipt.status = 'DUPLICATE';
      receipt.reason = 'entrega repetida (provider,externalId,event)';
      this.receipts.push(receipt);
      this.metrics.inc('billing.webhook.duplicate');
      return { http: 200, receipt };
    }

    // 2. Validação: evento conhecido + pagamento existe.
    const target = paymentTargetForAsaasEvent(event);
    const payment = this.payments.get(this.key(provider, externalId));
    receipt.status = 'VALIDATED';
    if (!target) {
      return this.reject(receipt, deliveryKey, `evento Asaas desconhecido: ${event}`);
    }
    if (!payment) {
      return this.reject(receipt, deliveryKey, `pagamento ${externalId} desconhecido (sem order)`);
    }

    // 3. Fora de ordem: evento antigo nunca regride estado terminal.
    if (isOutOfOrderRegression(payment.status, target)) {
      return this.reject(
        receipt,
        deliveryKey,
        `fora de ordem: ${target} não regride ${payment.status}`,
      );
    }

    // 4. PaymentConfirmed exige paidAt + amount casando.
    if (target === 'CONFIRMED') {
      const paidAt = payload.payment.confirmedDate ?? payload.occurredAt ?? null;
      const valueCents =
        typeof payload.payment.value === 'number' ? Math.round(payload.payment.value * 100) : null;
      if (!paidAt) {
        return this.reject(receipt, deliveryKey, 'CONFIRMED sem paidAt (confirmedDate ausente)');
      }
      if (valueCents !== null && valueCents !== payment.amountCents) {
        this.metrics.inc('billing.recon.diverged');
        return this.reject(
          receipt,
          deliveryKey,
          `divergência de valor: webhook ${valueCents} ≠ pedido ${payment.amountCents}`,
        );
      }
      const applied = this.applyTransition(receipt, deliveryKey, payment, 'CONFIRMED', {
        paidAt,
        eventId: paymentConfirmedEventId(externalId),
        event,
      });
      return { http: 200, receipt: applied };
    }

    const applied = this.applyTransition(receipt, deliveryKey, payment, target, {
      paidAt: null,
      eventId: `${paymentConfirmedEventId(externalId)}:${target.toLowerCase()}`,
      event,
    });
    return { http: 200, receipt: applied };
  }

  private reject(
    receipt: WebhookReceiptRecord,
    deliveryKey: string,
    reason: string,
  ): { http: 200; receipt: WebhookReceiptRecord } {
    receipt.status = 'REJECTED';
    receipt.reason = reason;
    this.seen.add(deliveryKey);
    this.receipts.push(receipt);
    this.alert('billing.webhook.rejected', `${receipt.event}/${receipt.externalId}: ${reason}`);
    this.metrics.inc('billing.webhook.rejected');
    return { http: 200, receipt };
  }

  private applyTransition(
    receipt: WebhookReceiptRecord,
    deliveryKey: string,
    payment: PaymentRecord,
    // `string` largo de propósito: o alvo vem de `paymentTargetForAsaasEvent`
    // e a validade é checada em runtime por `assertPaymentTransition`.
    target: string,
    opts: { paidAt: string | null; eventId: string; event: string },
  ): WebhookReceiptRecord {
    if (payment.status === target) {
      // Mesmo estado (reentrega com chave distinta): duplicate sem efeitos.
      receipt.status = 'DUPLICATE';
      receipt.reason = `pagamento já ${target}`;
      this.seen.add(deliveryKey);
      this.receipts.push(receipt);
      this.metrics.inc('billing.webhook.duplicate');
      return receipt;
    }
    const check = assertPaymentTransition(payment.status, target);
    if (!check.ok) {
      return this.reject(receipt, deliveryKey, check.reason).receipt;
    }
    payment.status = target as PaymentRecord['status'];
    if (opts.paidAt) payment.paidAt = opts.paidAt;
    payment.updatedAt = new Date().toISOString();
    this.seen.add(deliveryKey);
    receipt.status = 'APPLIED';
    this.receipts.push(receipt);
    this.metrics.inc('billing.webhook.applied');

    const type = outboxTypeForPaymentStatus(target);
    const now = new Date().toISOString();
    if (type) {
      this.emitOutbox({
        eventId: opts.eventId,
        aggregate: 'payment',
        aggregateId: payment.id,
        type,
        payload: {
          provider: payment.provider,
          externalId: payment.externalId,
          orderId: payment.orderId,
          amountCents: payment.amountCents,
          paidAt: payment.paidAt,
          asaasEvent: opts.event,
        },
        occurredAt: now,
      });
    }
    if (target === 'CONFIRMED') {
      const order = this.orders.get(payment.orderId);
      if (order) order.status = 'PAID';
      const invoice = order ? this.invoices.get(order.invoiceId) : undefined;
      if (invoice) invoice.status = 'PAID';
      // Hook de licença: TODO do worker (licensing) — registrado p/ verificação.
      // TODO(Fase 4-workers): `billing.webhook.apply` → fan-out PaymentConfirmed
      // para access/licensing/finance + `communications.send` (Resend).
      this.licenseHooks.push({
        eventId: opts.eventId,
        orderId: payment.orderId,
        paymentId: payment.id,
        action: 'TODO(worker licensing): issue/renew license a partir de PaymentConfirmed',
        appliedAt: now,
      });
      this.enqueueEmail({
        idempotencyKey: opts.eventId,
        template: 'payment-confirmed',
        templateVersion: 1,
        to: payment.customerId,
        eventId: opts.eventId,
        enqueuedAt: now,
      });
    }
    return receipt;
  }

  // --- reconciliação (hourly <7d + daily 30d; Asaas injetável) ----------------
  // Pagina o Asaas (stub), compara externalId → status e emite o sintético
  // `recon:<id>:<data>` pelo mesmo pipeline. Divergência → alerta + e-mail admin.

  reconTick(
    now: Date,
    fetchAsaas: (externalId: string) => { status: string; valueCents: number } | null,
  ): { checked: number; divergences: number; synthetic: string[] } {
    const day = now.toISOString().slice(0, 10);
    const cutoffMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    let checked = 0;
    let divergences = 0;
    const synthetic: string[] = [];
    for (const payment of this.paymentsById.values()) {
      if (Date.parse(payment.updatedAt) < cutoffMs) continue; // janela 30d
      if (isTerminalPayment(payment.status) && payment.status === 'REFUNDED') continue;
      checked += 1;
      this.metrics.inc('billing.recon.checked');
      const remote = fetchAsaas(payment.externalId);
      const eventId = reconEventId(payment.id, day);
      if (!remote) {
        divergences += 1;
        this.metrics.inc('billing.recon.diverged');
        this.alert('billing.recon.diverged', `${payment.externalId}: ausente no Asaas`);
        continue;
      }
      const remoteStatus = remote.status === 'CONFIRMED' ? 'CONFIRMED' : remote.status;
      if (remoteStatus !== payment.status || remote.valueCents !== payment.amountCents) {
        divergences += 1;
        this.metrics.inc('billing.recon.diverged');
        this.alert(
          'billing.recon.diverged',
          `${payment.externalId}: local ${payment.status}/${payment.amountCents} ≠ asaas ${remoteStatus}/${remote.valueCents}`,
        );
        this.enqueueEmail({
          idempotencyKey: `${eventId}:admin`,
          template: 'payment-failed',
          templateVersion: 1,
          to: 'admin',
          eventId: `${eventId}:admin`,
          enqueuedAt: now.toISOString(),
        });
      }
      if (
        this.emitOutbox({
          eventId,
          aggregate: 'recon',
          aggregateId: payment.id,
          type: 'billing.reconciliation.completed.v1',
          payload: { externalId: payment.externalId, local: payment.status, remote: remoteStatus },
          occurredAt: now.toISOString(),
        })
      ) {
        synthetic.push(eventId);
      }
    }
    this.metrics.inc('billing.recon.completed');
    return { checked, divergences, synthetic };
  }
}
