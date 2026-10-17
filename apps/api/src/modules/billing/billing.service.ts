import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { BILLING_POOL } from './billing-pool.provider';
import {
  CancelDto,
  CheckoutOrderDto,
  ConfirmPaymentDto,
  CreateInvoiceDto,
  CreateRefundDto,
  CreateSubscriptionDto,
  RegisterPaymentDto,
  SyncCustomerDto,
} from './billing.dto';
import {
  BillingAggregate,
  IllegalTransitionError,
  assertTransition,
  buildInvoiceNumber,
  outboxTypeForPaymentStatus,
  paymentConfirmedEventId,
} from './billing-transitions';

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

const CUSTOMER_COLS = `id, "userId", "asaasCustomerId", name, email, "cpfCnpj", "createdAt", "updatedAt"`;
const SUBSCRIPTION_COLS = `id, "customerId", "asaasSubscriptionId", status, "planRef", "billingInterval", "idempotencyKey", "currentPeriodStart", "currentPeriodEnd", "canceledAt", "createdAt", "updatedAt"`;
const INVOICE_COLS = `id, number, "customerId", "subscriptionId", "orderId", "asaasInvoiceId", status, "billingInterval", "productId", "planRef", "amountCents", "discountCents", "fineCents", "interestCents", "dueDate", "paidAt", "idempotencyKey", "createdAt", "updatedAt"`;
const PAYMENT_COLS = `id, provider, "externalId", "customerId", "invoiceId", "amountCents", method, status, "idempotencyKey", "paidAt", version, "occurredAt", "createdAt", "updatedAt"`;
const REFUND_COLS = `id, "paymentId", provider, "externalId", "amountCents", status, "idempotencyKey", reason, "createdAt", "updatedAt"`;

// Fase 8: intervalos comerciais (espelham products.ProductPlan.billingInterval).
// Validação server-side em Subscription/Invoice/checkout (ROADMAP Fase 8).
export const BILLING_INTERVALS = ['MONTH', 'YEAR', 'ONE_TIME'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

function assertBillingInterval(v: unknown, where: string): asserts v is BillingInterval {
  if (typeof v !== 'string' || !(BILLING_INTERVALS as readonly string[]).includes(v)) {
    throw new BadRequestException(
      `${where}: billingInterval inválido (${String(v)}) — use MONTH, YEAR ou ONE_TIME`,
    );
  }
}

// Hook de pagamento confirmado: emite outbox `billing.payment.confirmed.v1`
// (lado access/licensing consome — NÃO implementado aqui). Consumidores
// idempotentes por eventId.
export const BILLING_OUTBOX_AGGREGATES = ['Payment', 'Invoice', 'Subscription', 'Refund'] as const;

// Fase 4 — Billing core. Pool PG próprio (DATABASE_URL_BILLING); sem
// acesso a outros domínios. Toda mutação insere o OutboxEvent na mesma
// transação (relay publica; consumidores idempotentes por eventId).
// Webhook controller: outro workstream — aqui só modelo + transições +
// hooks de aplicação (confirm/complete) reutilizáveis pelo pipeline.
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(@Inject(BILLING_POOL) private readonly pool: Pool) {}

  /**
   * Ilegal → 422 + alerta `billing.transition_rejected`, SEM sobrescrever
   * a linha (PROJECT.md §5). Chamado antes de qualquer UPDATE.
   */
  private reject(aggregate: BillingAggregate, from: string, to: string, err: IllegalTransitionError, extra: Record<string, unknown> = {}): never {
    this.logger.warn(
      JSON.stringify({
        event: 'billing.transition_rejected',
        aggregate,
        from,
        to,
        allowed: err.allowed,
        ...extra,
        at: new Date().toISOString(),
      }),
    );
    throw new UnprocessableEntityException(
      `transição ilegal em ${aggregate}: ${from} → ${to}`,
    );
  }

  private check(aggregate: BillingAggregate, from: string, to: string, extra: Record<string, unknown> = {}): void {
    try {
      assertTransition(aggregate, from, to);
    } catch (e) {
      if (e instanceof IllegalTransitionError) this.reject(aggregate, from, to, e, extra);
      throw e;
    }
  }

  // -- Customer espelho -------------------------------------------------

  async syncCustomer(dto: SyncCustomerDto) {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO customers (id, "userId", "asaasCustomerId", name, email, "cpfCnpj", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,now(),now())
         ON CONFLICT ("userId") DO UPDATE SET
           "asaasCustomerId" = COALESCE(EXCLUDED."asaasCustomerId", customers."asaasCustomerId"),
           name = COALESCE(EXCLUDED.name, customers.name),
           email = COALESCE(EXCLUDED.email, customers.email),
           "cpfCnpj" = COALESCE(EXCLUDED."cpfCnpj", customers."cpfCnpj"),
           "updatedAt" = now()
         RETURNING ${CUSTOMER_COLS}`,
        [randomUUID(), dto.userId, dto.asaasCustomerId ?? null, dto.name ?? null, dto.email ?? null, dto.cpfCnpj ?? null],
      );
      return rows[0];
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('asaasCustomerId já vinculado a outro titular');
      }
      throw e;
    }
  }

  // -- Invoice ----------------------------------------------------------

  async createInvoice(dto: CreateInvoiceDto, idempotencyKey?: string) {
    // Replay: mesma chave → mesma fatura, sem duplicar nem reemitir outbox.
    if (idempotencyKey) {
      const existing = await this.findInvoiceByKey(idempotencyKey);
      if (existing) return existing;
    }
    if (dto.billingInterval !== undefined) assertBillingInterval(dto.billingInterval, 'invoice');
    if (dto.orderId) {
      const { rows } = await this.pool.query(
        `SELECT ${INVOICE_COLS} FROM invoices WHERE "orderId" = $1`,
        [dto.orderId],
      );
      if (rows.length > 0) return rows[0];
    }
    const year = new Date().getUTCFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
      const number = buildInvoiceNumber(year);
      try {
        const { rows } = await this.pool.query(
          `INSERT INTO invoices (id, number, "customerId", "subscriptionId", "orderId", "asaasInvoiceId",
             status, "billingInterval", "productId", "planRef", "amountCents", "discountCents", "fineCents", "interestCents", "dueDate", "idempotencyKey",
             "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now())
           RETURNING ${INVOICE_COLS}`,
          [
            randomUUID(), number, dto.customerId, dto.subscriptionId ?? null,
            dto.orderId ?? null, dto.asaasInvoiceId ?? null, dto.billingInterval ?? null,
            dto.productId ?? null, dto.planRef ?? null, dto.amountCents,
            dto.discountCents ?? 0, dto.fineCents ?? 0, dto.interestCents ?? 0,
            dto.dueDate, idempotencyKey ?? null,
          ],
        );
        return rows[0];
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        // Colisão de number → regenera; colisão de chave/orderId (race) → replay.
        if (idempotencyKey) {
          const existing = await this.findInvoiceByKey(idempotencyKey);
          if (existing) return existing;
        }
        if (dto.orderId) {
          const { rows } = await this.pool.query(
            `SELECT ${INVOICE_COLS} FROM invoices WHERE "orderId" = $1`,
            [dto.orderId],
          );
          if (rows.length > 0) return rows[0];
        }
      }
    }
    throw new ConflictException('não foi possível gerar número de fatura único; tente novamente');
  }

  private async findInvoiceByKey(key: string) {
    const { rows } = await this.pool.query(
      `SELECT ${INVOICE_COLS} FROM invoices WHERE "idempotencyKey" = $1`,
      [key],
    );
    return rows[0] ?? null;
  }

  async getInvoice(id: string) {
    const { rows } = await this.pool.query(`SELECT ${INVOICE_COLS} FROM invoices WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException(`invoice ${id} não encontrada`);
    return rows[0];
  }

  /**
   * Lista faturas (leitura admin). Paginação keyset ordenada
   * ("createdAt", id); cursor = id opaco (nunca offset); teto 100.
   * Filtros: status exato, dueDate em [dueFrom, dueTo].
   */
  async listInvoices(filters: {
    status?: string;
    dueFrom?: string;
    dueTo?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ data: unknown[]; meta: { nextCursor: string | null; limit: number } }> {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      params.push(filters.status);
      conds.push(`status = $${params.length}`);
    }
    if (filters.dueFrom) {
      params.push(filters.dueFrom);
      conds.push(`"dueDate" >= $${params.length}`);
    }
    if (filters.dueTo) {
      params.push(filters.dueTo);
      conds.push(`"dueDate" <= $${params.length}`);
    }
    if (filters.cursor) {
      const { rows: anchor } = await this.pool.query(
        `SELECT "createdAt", id FROM invoices WHERE id = $1`,
        [filters.cursor],
      );
      // Cursor desconhecido → ignora (começa do início; documentado).
      if (anchor.length > 0) {
        params.push(anchor[0].createdAt, filters.cursor);
        conds.push(`(("createdAt", id) > ($${params.length - 1}, $${params.length}))`);
      }
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit + 1);
    const { rows } = await this.pool.query(
      `SELECT ${INVOICE_COLS} FROM invoices ${where} ORDER BY "createdAt", id LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      data,
      meta: { nextCursor: hasMore && data.length > 0 ? (data[data.length - 1] as { id: string }).id : null, limit },
    };
  }

  /**
   * Payments da fatura (leitura admin). 404 se a fatura não existe;
   * fatura existente sem payments → [] honesto.
   */
  async listInvoicePayments(invoiceId: string) {
    await this.getInvoice(invoiceId); // 404 sem PII se ausente
    const { rows } = await this.pool.query(
      `SELECT ${PAYMENT_COLS} FROM payments WHERE "invoiceId" = $1 ORDER BY "createdAt", id LIMIT 100`,
      [invoiceId],
    );
    return rows;
  }

  /**
   * Emissão (DRAFT → PENDING). Sem rota de emissão a fatura nunca sai do
   * rascunho — telas admin precisam deste passo (assertTransition permite
   * DRAFT → PENDING/OVERDUE/PAID/CANCELLED).
   */
  async emitInvoice(id: string) {
    const current = await this.getInvoice(id);
    this.check('invoice', current.status, 'PENDING', { invoiceId: id });
    if (current.status === 'PENDING') return current; // replay idempotente
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE invoices SET status = 'PENDING', "updatedAt" = now() WHERE id = $1 RETURNING ${INVOICE_COLS}`,
        [id],
      );
      await this.insertOutbox(client, 'Invoice', id, 'InvoiceEmitted', { invoiceId: id });
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async cancelInvoice(id: string, dto: CancelDto) {
    const current = await this.getInvoice(id);
    this.check('invoice', current.status, 'CANCELLED', { invoiceId: id });
    if (current.status === 'CANCELLED') return current; // replay idempotente
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE invoices SET status = 'CANCELLED', "updatedAt" = now() WHERE id = $1 RETURNING ${INVOICE_COLS}`,
        [id],
      );
      await this.insertOutbox(client, 'Invoice', id, 'InvoiceCancelled', { invoiceId: id, reason: dto.reason });
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  // -- Checkout pós-pagamento real (Fase 8) -------------------------------
  // Cria invoice PENDING idempotente por orderId (UNIQUE) e devolve a sessão
  // PENDING — nunca `done`: a licença só nasce no PaymentConfirmed
  // (issueFromPayment, lado licensing). Reaproveita createInvoice +
  // emitInvoice (DRAFT → PENDING + outbox InvoiceEmitted).
  async createCheckoutOrder(dto: CheckoutOrderDto) {
    assertBillingInterval(dto.billingInterval, 'checkout');
    const replay = await this.findCheckoutByOrder(dto.orderId);
    if (replay) return replay;
    const invoice = await this.createInvoice(
      {
        customerId: dto.customerId,
        orderId: dto.orderId,
        amountCents: dto.amountCents,
        billingInterval: dto.billingInterval,
        productId: dto.productId,
        planRef: dto.planRef,
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      `checkout:${dto.orderId}`,
    );
    const pending = invoice.status === 'PENDING' ? invoice : await this.emitInvoice(invoice.id);
    return this.toCheckoutSession(pending);
  }

  /** Sessão por orderId: invoice + payments + status derivado (sem PII além do necessário). */
  async getCheckoutOrder(orderId: string) {
    const session = await this.findCheckoutByOrder(orderId);
    if (!session) throw new NotFoundException(`checkout order ${orderId} não encontrado`);
    return session;
  }

  private async findCheckoutByOrder(orderId: string) {
    const { rows } = await this.pool.query(
      `SELECT ${INVOICE_COLS} FROM invoices WHERE "orderId" = $1`,
      [orderId],
    );
    if (rows.length === 0) return null;
    return this.toCheckoutSession(rows[0]);
  }

  private async toCheckoutSession(invoice: Record<string, unknown> & { id: string; status: string }) {
    const { rows: payments } = await this.pool.query(
      `SELECT ${PAYMENT_COLS} FROM payments WHERE "invoiceId" = $1 ORDER BY "createdAt", id LIMIT 10`,
      [invoice.id],
    );
    const confirmed = (payments as Array<{ status: string }>).some((p) => p.status === 'CONFIRMED');
    return {
      orderId: invoice.orderId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amountCents: invoice.amountCents,
      billingInterval: (invoice as Record<string, unknown>).billingInterval ?? null,
      status: confirmed ? 'PAID' : invoice.status,
      payments: (payments as Array<Record<string, unknown>>).map((p) => ({
        id: p.id,
        provider: p.provider,
        status: p.status,
        paidAt: p.paidAt ?? null,
      })),
    };
  }

  /**
   * Contexto p/ issue-from-payment (Fase 8, interno worker→API).
   * Junta payment + invoice (refs opacas do pedido) + userId do titular
   * (billing.Customer.userId = customers.Customer.id) — tudo do próprio
   * domínio, sem leitura cross-schema. 404 opaco se qualquer peça ausente.
   */
  async getIssueContext(paymentId: string) {
    const payment = await this.getPayment(paymentId);
    if (!payment.invoiceId) throw new NotFoundException(`payment ${paymentId} sem fatura vinculada`);
    const invoice = await this.getInvoice(payment.invoiceId);
    const { rows } = await this.pool.query(
      `SELECT ${CUSTOMER_COLS} FROM customers WHERE id = $1`,
      [payment.customerId],
    );
    if (rows.length === 0) throw new NotFoundException(`customer do payment ${paymentId} não encontrado`);
    const customer = rows[0] as { userId: string };
    return {
      payment: {
        id: payment.id,
        externalId: payment.externalId,
        amountCents: payment.amountCents,
        status: payment.status,
        paidAt: payment.paidAt ?? null,
      },
      invoice: {
        id: invoice.id,
        orderId: invoice.orderId ?? null,
        productId: invoice.productId ?? null,
        planRef: invoice.planRef ?? null,
        billingInterval: invoice.billingInterval ?? null,
        status: invoice.status,
      },
      ownerUserId: customer.userId,
    };
  }

  // -- Subscription -----------------------------------------------------

  async createSubscription(dto: CreateSubscriptionDto, idempotencyKey?: string) {
    const key = idempotencyKey ?? randomUUID();
    if (dto.billingInterval !== undefined) assertBillingInterval(dto.billingInterval, 'subscription');
    const { rows } = await this.pool.query(
      `SELECT ${SUBSCRIPTION_COLS} FROM subscriptions WHERE "idempotencyKey" = $1`,
      [key],
    );
    if (rows.length > 0) return rows[0]; // replay
    try {
      const { rows: inserted } = await this.pool.query(
        `INSERT INTO subscriptions (id, "customerId", "asaasSubscriptionId", status, "planRef", "billingInterval",
           "idempotencyKey", "currentPeriodStart", "currentPeriodEnd", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,now(),now())
         RETURNING ${SUBSCRIPTION_COLS}`,
        [
          randomUUID(), dto.customerId, dto.asaasSubscriptionId ?? null, dto.planRef ?? null,
          dto.billingInterval ?? null, key, dto.currentPeriodStart ?? null, dto.currentPeriodEnd ?? null,
        ],
      );
      return inserted[0];
    } catch (e) {
      if (isUniqueViolation(e)) {
        // Race na chave (replay concorrente) ou asaasSubscriptionId duplicado.
        const { rows: replay } = await this.pool.query(
          `SELECT ${SUBSCRIPTION_COLS} FROM subscriptions WHERE "idempotencyKey" = $1`,
          [key],
        );
        if (replay.length > 0) return replay[0];
        throw new ConflictException('asaasSubscriptionId já vinculado a outra subscription');
      }
      throw e;
    }
  }

  async getSubscription(id: string) {
    const { rows } = await this.pool.query(`SELECT ${SUBSCRIPTION_COLS} FROM subscriptions WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException(`subscription ${id} não encontrada`);
    return rows[0];
  }

  /**
   * Leitura espelho do titular p/ telas admin (nome/e-mail p/ listagens).
   * Sem PII sensível (só o já mascarado em suporte). 404 sem vazar existência.
   */
  async getCustomer(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT ${CUSTOMER_COLS} FROM customers WHERE "userId" = $1`,
      [userId],
    );
    if (rows.length === 0) throw new NotFoundException(`customer ${userId} não encontrado`);
    return rows[0];
  }

  /**
   * Lista subscriptions (leitura admin). Paginação keyset ordenada
   * ("createdAt", id); cursor = id opaco (nunca offset); teto 100.
   */
  async listSubscriptions(filters: {
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ data: unknown[]; meta: { nextCursor: string | null; limit: number } }> {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      params.push(filters.status);
      conds.push(`subscriptions.status = $${params.length}`);
    }
    if (filters.cursor) {
      const { rows: anchor } = await this.pool.query(
        `SELECT "createdAt", id FROM subscriptions WHERE id = $1`,
        [filters.cursor],
      );
      // Cursor desconhecido → ignora (começa do início; documentado).
      if (anchor.length > 0) {
        params.push(anchor[0].createdAt, filters.cursor);
        conds.push(`((subscriptions."createdAt", subscriptions.id) > ($${params.length - 1}, $${params.length}))`);
      }
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit + 1);
    // Enriquece com a fatura mais recente (valor + vencimento p/ telas admin).
    // Colunas qualificadas (o JOIN traz `id`/`status` das duas tabelas).
    const { rows } = await this.pool.query(
      `SELECT subscriptions.id, subscriptions."customerId", subscriptions."asaasSubscriptionId",
        subscriptions.status, subscriptions."planRef", subscriptions."idempotencyKey",
        subscriptions."currentPeriodStart", subscriptions."currentPeriodEnd",
        subscriptions."canceledAt", subscriptions."createdAt", subscriptions."updatedAt",
        li."amountCents" AS "lastInvoiceAmountCents", li."dueDate" AS "lastInvoiceDueDate"
       FROM subscriptions LEFT JOIN LATERAL (
         SELECT "amountCents", "dueDate" FROM invoices
         WHERE "subscriptionId" = subscriptions.id
         ORDER BY "createdAt" DESC LIMIT 1
       ) li ON true
       ${where} ORDER BY subscriptions."createdAt", subscriptions.id LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      data,
      meta: { nextCursor: hasMore && data.length > 0 ? (data[data.length - 1] as { id: string }).id : null, limit },
    };
  }

  /**
   * Ativação (DRAFT → ACTIVE). Sem rota HTTP própria: chamada pelo
   * pipeline de webhook/reconciliação (outro workstream) após a primeira
   * cobrança confirmada no provider.
   */
  async activateSubscription(id: string) {
    const current = await this.getSubscription(id);
    this.check('subscription', current.status, 'ACTIVE', { subscriptionId: id });
    if (current.status === 'ACTIVE') return current;
    const { rows } = await this.pool.query(
      `UPDATE subscriptions SET status = 'ACTIVE', "updatedAt" = now() WHERE id = $1 RETURNING ${SUBSCRIPTION_COLS}`,
      [id],
    );
    return rows[0];
  }

  async cancelSubscription(id: string, dto: CancelDto) {
    const current = await this.getSubscription(id);
    this.check('subscription', current.status, 'CANCELLED', { subscriptionId: id });
    if (current.status === 'CANCELLED') return current;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE subscriptions SET status = 'CANCELLED', "canceledAt" = now(), "updatedAt" = now()
         WHERE id = $1 RETURNING ${SUBSCRIPTION_COLS}`,
        [id],
      );
      await this.insertOutbox(client, 'Subscription', id, 'SubscriptionCancelled', {
        subscriptionId: id,
        reason: dto.reason,
      });
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  // -- Payment ----------------------------------------------------------

  /**
   * Registra pagamento do provider. Idempotente por
   * UNIQUE(provider, externalId): `ON CONFLICT DO NOTHING` → replay
   * retorna a linha existente (PROJECT.md §5 — duplicate → 200, aqui:
   * retorna o existente sem duplicar nem reemitir outbox).
   */
  async registerPayment(dto: RegisterPaymentDto, idempotencyKey?: string) {
    const key = idempotencyKey ?? randomUUID();
    if (dto.invoiceId) await this.getInvoice(dto.invoiceId); // FK intra-DB válida (404 se ausente)
    const { rows } = await this.pool.query(
      `INSERT INTO payments (id, provider, "externalId", "customerId", "invoiceId",
         "amountCents", method, status, "idempotencyKey", version, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,1,now(),now())
       ON CONFLICT (provider, "externalId") DO NOTHING
       RETURNING ${PAYMENT_COLS}`,
      [
        randomUUID(), dto.provider, dto.externalId, dto.customerId, dto.invoiceId ?? null,
        dto.amountCents, dto.method ?? null, key,
      ],
    );
    if (rows.length > 0) return rows[0];
    // Conflito: replay — retorna o existente sem duplicar.
    const { rows: existing } = await this.pool.query(
      `SELECT ${PAYMENT_COLS} FROM payments WHERE provider = $1 AND "externalId" = $2`,
      [dto.provider, dto.externalId],
    );
    if (existing.length > 0) return existing[0];
    // Race rara na idempotencyKey com externalId distinto: replay pela chave.
    const { rows: byKey } = await this.pool.query(
      `SELECT ${PAYMENT_COLS} FROM payments WHERE "idempotencyKey" = $1`,
      [key],
    );
    if (byKey.length > 0) return byKey[0];
    throw new ConflictException('pagamento não pôde ser registrado; tente novamente');
  }

  async getPayment(id: string) {
    const { rows } = await this.pool.query(`SELECT ${PAYMENT_COLS} FROM payments WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException(`payment ${id} não encontrado`);
    return rows[0];
  }

  /**
   * Hook de pagamento confirmado (PROJECT.md §5): exige `paidAt + amount`
   * casando; fora de ordem (version/occurredAt antigo) nunca regride
   * terminal — retorna o atual sem sobrescrever. Emite outbox com o
   * tópico canônico `billing.payment.confirmed.v1` (lado access/licensing
   * consome — fora deste módulo).
   * Fatura vinculada (PENDING/OVERDUE) vira PAID na mesma transação.
   *
   * Guarda de concorrência: `getPayment()` + `check()` rodam FORA da txn,
   * então dois webhooks duplicados do provedor podem passar nos dois
   * juntos. O `AND status <> 'CONFIRMED'` no WHERE é o backstop atômico —
   * o perdedor casa 0 linhas, volta via ROLLBACK e devolve o estado atual
   * (replay idempotente, não erro). O outbox usa eventId determinístico
   * (`paymentConfirmedEventId(payment.id)`) + `ON CONFLICT DO NOTHING`,
   * então `UNIQUE outbox_events_eventId_key` vira backstop real do
   * `UNIQUE(eventId)` — nunca 2 linhas de
   * `billing.payment.confirmed.v1` para o mesmo pagamento.
   */
  async confirmPayment(id: string, dto: ConfirmPaymentDto) {
    const current = await this.getPayment(id);
    if (current.amountCents !== dto.amountCents) {
      this.logger.warn(
        JSON.stringify({
          event: 'billing.payment_amount_mismatch',
          paymentId: id,
          expected: current.amountCents,
          received: dto.amountCents,
          at: new Date().toISOString(),
        }),
      );
      throw new UnprocessableEntityException('valor divergente do pagamento registrado');
    }
    if (current.status === 'CONFIRMED') return current; // replay idempotente
    this.check('payment', current.status, 'CONFIRMED', { paymentId: id });
    // Fora de ordem: evento mais antigo que o estado atual não aplica.
    if (typeof current.version === 'number' && dto.version != null && dto.version < current.version) {
      this.logger.warn(
        JSON.stringify({
          event: 'billing.stale_event_ignored',
          paymentId: id,
          storedVersion: current.version,
          incomingVersion: dto.version,
          at: new Date().toISOString(),
        }),
      );
      return current;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Guarda de status no WHERE: o pagamento só é confirmado se ainda não
      // estiver CONFIRMED no momento do lock (EvalPlanQual do PG garante o
      // re-check após o lock da transação concorrente).
      const { rows } = await client.query(
        `UPDATE payments SET status = 'CONFIRMED', "paidAt" = $2, version = $3,
           "occurredAt" = COALESCE($4, "occurredAt"), "updatedAt" = now()
         WHERE id = $1 AND status <> 'CONFIRMED' RETURNING ${PAYMENT_COLS}`,
        [id, dto.paidAt, dto.version ?? current.version + 1, dto.occurredAt ?? null],
      );
      if (rows.length === 0) {
        // Perdedor da race (webhook duplicado): replay idempotente, sem
        // segunda linha `billing.payment.confirmed.v1` no outbox e sem 500.
        await client.query('ROLLBACK');
        return this.getPayment(id);
      }
      const payment = rows[0];
      let invoice = null;
      if (payment.invoiceId) {
        const { rows: invRows } = await client.query(
          `SELECT ${INVOICE_COLS} FROM invoices WHERE id = $1`,
          [payment.invoiceId],
        );
        if (invRows.length > 0 && (invRows[0].status === 'PENDING' || invRows[0].status === 'OVERDUE')) {
          const { rows: paid } = await client.query(
            `UPDATE invoices SET status = 'PAID', "paidAt" = $2, "updatedAt" = now()
             WHERE id = $1 RETURNING ${INVOICE_COLS}`,
            [payment.invoiceId, dto.paidAt],
          );
          invoice = paid[0];
        } else if (invRows.length > 0) {
          invoice = invRows[0];
        }
      }
      // `type` do outbox = tópico canônico da fila (fonte única:
      // billing-transitions.ts) — o relay publica por ele e `routeBillingTopic`
      // roteia `billing.payment.confirmed.v1` p/ o fan-out. `CONFIRMED` sempre
      // tem tópico: o guard só estreita `string | null` p/ `string`.
      const outboxType = outboxTypeForPaymentStatus('CONFIRMED');
      if (!outboxType) throw new Error('CONFIRMED sem tópico de outbox');
      await this.insertOutbox(
        client,
        'Payment',
        id,
        outboxType,
        {
          paymentId: id,
          invoiceId: payment.invoiceId,
          provider: payment.provider,
          externalId: payment.externalId,
          amountCents: payment.amountCents,
          paidAt: dto.paidAt,
        },
        // eventId determinístico: mesmo pagamento → mesmo fato de negócio →
        // mesmo eventId. Prefixo `billing:payment-confirmed:` (mesmo de
        // billing-flow.service) — 3 segmentos, exigido pelo `jobId = eventId`
        // do relay BullMQ (ver billing-transitions.ts); não colide com `recon:`
        // (isReconEventId) nem depende de `externalId`, que só é único por
        // (provider, id).
        paymentConfirmedEventId(payment.id),
      );
      await client.query('COMMIT');
      return { payment, invoice };
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  // -- Refund -----------------------------------------------------------

  async createRefund(paymentId: string, dto: CreateRefundDto, idempotencyKey?: string) {
    const payment = await this.getPayment(paymentId);
    if (payment.status !== 'CONFIRMED') {
      this.logger.warn(
        JSON.stringify({
          event: 'billing.transition_rejected',
          aggregate: 'refund',
          from: payment.status,
          to: 'REQUESTED',
          reason: 'refund exige pagamento CONFIRMED',
          paymentId,
          at: new Date().toISOString(),
        }),
      );
      throw new UnprocessableEntityException('reembolso exige pagamento CONFIRMED');
    }
    const key = idempotencyKey ?? randomUUID();
    const { rows } = await this.pool.query(
      `SELECT ${REFUND_COLS} FROM refunds WHERE "idempotencyKey" = $1`,
      [key],
    );
    if (rows.length > 0) return rows[0]; // replay
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: inserted } = await client.query(
        `INSERT INTO refunds (id, "paymentId", provider, "externalId", "amountCents",
           status, "idempotencyKey", reason, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,'REQUESTED',$6,$7,now(),now())
         RETURNING ${REFUND_COLS}`,
        [randomUUID(), paymentId, payment.provider, dto.externalId ?? null, dto.amountCents, key, dto.reason ?? null],
      );
      await this.insertOutbox(client, 'Refund', inserted[0].id, 'RefundRequested', {
        refundId: inserted[0].id,
        paymentId,
        amountCents: dto.amountCents,
        reason: dto.reason ?? null,
      });
      await client.query('COMMIT');
      return inserted[0];
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      if (isUniqueViolation(e)) {
        const { rows: replay } = await this.pool.query(
          `SELECT ${REFUND_COLS} FROM refunds WHERE "idempotencyKey" = $1`,
          [key],
        );
        if (replay.length > 0) return replay[0];
        throw new ConflictException('externalId de reembolso já utilizado');
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async getRefund(id: string) {
    const { rows } = await this.pool.query(`SELECT ${REFUND_COLS} FROM refunds WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException(`refund ${id} não encontrado`);
    return rows[0];
  }

  /**
   * `eventId` explícito = fato de negócio determinístico: habilita
   * `ON CONFLICT ("eventId") DO NOTHING`, então `UNIQUE outbox_events_eventId_key`
   * passa a ser backstop real em vez de decorativo (com `randomUUID()` nunca
   * colide). Sem o param, mantém o comportamento anterior (UUID + falha dura).
   */
  private async insertOutbox(
    client: PoolClient,
    aggregate: string,
    aggregateId: string,
    type: string,
    payload: Record<string, unknown>,
    eventId?: string,
  ): Promise<string> {
    const eid = eventId ?? randomUUID();
    await client.query(
      `INSERT INTO outbox_events (id, "eventId", aggregate, "aggregateId", type, payload, "occurredAt", published, "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,now(),false,now())${eventId ? ' ON CONFLICT ("eventId") DO NOTHING' : ''}`,
      [randomUUID(), eid, aggregate, aggregateId, type, JSON.stringify(payload)],
    );
    return eid;
  }
}
