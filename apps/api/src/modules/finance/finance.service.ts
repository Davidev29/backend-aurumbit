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
import { FINANCE_POOL } from './finance-pool.provider';
import {
  CreatePayableDto,
  CreateReceivableDto,
  MarkPaidDto,
  MarkReceivedDto,
} from './finance.dto';
import { FinanceAggregate, IllegalTransitionError, assertTransition } from './finance-transitions';

// Fase 9 (ADR-006 §6): categorias/contas sao append-only — só create/list/get
// (sem endpoint de DELETE). Desativacao é soft via active=false; hard DELETE
// é bloqueado pelas FKs RESTRICT (migration 0003_fase9_fks_indices).
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

// Baixas manuais exigem `Idempotency-Key` (mín. 8 chars — mesmo padrão de
// `finance-automation.service.ts`/`FinanceAutomationController.keyOf`).
// Antes, `idempotencyKey ?? randomUUID()` gerava chave nova a cada request
// sem o header: a dedupe por `UNIQUE(financial_transactions.idempotencyKey)`
// nunca protegia e o retry virava 2ª Transaction + saldo creditado 2×.
function requireIdempotencyKey(key?: string): string {
  const k = (key ?? '').trim();
  if (k.length < 8) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_REQUIRED',
      message: 'Idempotency-Key obrigatória (mín. 8 chars).',
    });
  }
  return k;
}

const CATEGORY_COLS = `id, "orgId", code, name, type, active, "createdAt", "updatedAt"`;
const ACCOUNT_COLS = `id, "orgId", code, name, type, "balanceCents", active, "createdAt", "updatedAt"`;
const RECEIVABLE_COLS = `id, "orgId", "sourceType", "sourceId", "categoryId", "amountCents", "dueDate", status, "receivedAt", "accountId", "createdAt", "updatedAt"`;
const PAYABLE_COLS = `id, "orgId", "sourceType", "sourceId", "categoryId", "amountCents", "dueDate", status, "paidAt", "accountId", "createdAt", "updatedAt"`;
const TXN_COLS = `id, "orgId", "accountId", "categoryId", kind, "amountCents", "occurredAt", "receivableId", "payableId", provider, "externalId", "idempotencyKey", "createdAt", "updatedAt"`;

// Fase 5 — Finance core. Pool PG próprio (DATABASE_URL_FINANCE); sem
// acesso a outros domínios. Toda query é escopada por orgId (WHERE orgId).
// REGRA DE OURO: `financial_accounts.balanceCents` SÓ é mutado em
// `markReceived`/`markPaid`, via FinancialTransaction na mesma txn —
// nenhum outro método contém UPDATE em balanceCents.
// Baixas são idempotentes: replay do mesmo idempotencyKey (ou de um título
// já baixado) retorna o existente sem duplicar nem reemitir outbox.
// Projections compute: OUTRO workstream — aqui só persistência/consulta
// do realizado; nenhum cálculo de projeção neste service.
@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(@Inject(FINANCE_POOL) private readonly pool: Pool) {}

  /**
   * Ilegal → 422 + alerta `finance.transition_rejected`, SEM sobrescrever
   * a linha (PROJECT.md §5).
   */
  private reject(
    aggregate: FinanceAggregate,
    from: string,
    to: string,
    err: IllegalTransitionError,
    extra: Record<string, unknown> = {},
  ): never {
    this.logger.warn(
      JSON.stringify({
        event: 'finance.transition_rejected',
        aggregate,
        from,
        to,
        allowed: err.allowed,
        ...extra,
        at: new Date().toISOString(),
      }),
    );
    throw new UnprocessableEntityException(`transição ilegal em ${aggregate}: ${from} → ${to}`);
  }

  private check(aggregate: FinanceAggregate, from: string, to: string, extra: Record<string, unknown> = {}): void {
    try {
      assertTransition(aggregate, from, to);
    } catch (e) {
      if (e instanceof IllegalTransitionError) this.reject(aggregate, from, to, e, extra);
      throw e;
    }
  }

  // -- Categories (CRUD de leitura + criação idempotente por (org, code)) --

  async createCategory(orgId: string, dto: { code: string; name?: string; type: string }) {
    const { rows } = await this.pool.query(
      `INSERT INTO financial_categories (id, "orgId", code, name, type, active, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,true,now(),now())
       ON CONFLICT ("orgId", code) DO NOTHING
       RETURNING ${CATEGORY_COLS}`,
      [randomUUID(), orgId, dto.code, dto.name ?? null, dto.type],
    );
    if (rows.length > 0) return rows[0];
    const { rows: existing } = await this.pool.query(
      `SELECT ${CATEGORY_COLS} FROM financial_categories WHERE "orgId" = $1 AND code = $2`,
      [orgId, dto.code],
    );
    return existing[0];
  }

  async listCategories(orgId: string, activeOnly = false) {
    const { rows } = await this.pool.query(
      `SELECT ${CATEGORY_COLS} FROM financial_categories WHERE "orgId" = $1` +
        (activeOnly ? ` AND active = true` : ``) +
        ` ORDER BY code`,
      [orgId],
    );
    return rows;
  }

  async getCategory(orgId: string, id: string) {
    const { rows } = await this.pool.query(
      `SELECT ${CATEGORY_COLS} FROM financial_categories WHERE id = $1 AND "orgId" = $2`,
      [id, orgId],
    );
    if (rows.length === 0) throw new NotFoundException(`categoria ${id} não encontrada`);
    return rows[0];
  }

  // -- Accounts (CRUD de leitura + criação idempotente por (org, code)) ----

  async createAccount(orgId: string, dto: { code: string; name?: string; type: string }) {
    const { rows } = await this.pool.query(
      `INSERT INTO financial_accounts (id, "orgId", code, name, type, "balanceCents", active, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,0,true,now(),now())
       ON CONFLICT ("orgId", code) DO NOTHING
       RETURNING ${ACCOUNT_COLS}`,
      [randomUUID(), orgId, dto.code, dto.name ?? null, dto.type],
    );
    if (rows.length > 0) return rows[0];
    const { rows: existing } = await this.pool.query(
      `SELECT ${ACCOUNT_COLS} FROM financial_accounts WHERE "orgId" = $1 AND code = $2`,
      [orgId, dto.code],
    );
    return existing[0];
  }

  async listAccounts(orgId: string, activeOnly = false) {
    const { rows } = await this.pool.query(
      `SELECT ${ACCOUNT_COLS} FROM financial_accounts WHERE "orgId" = $1` +
        (activeOnly ? ` AND active = true` : ``) +
        ` ORDER BY code`,
      [orgId],
    );
    return rows;
  }

  async getAccount(orgId: string, id: string) {
    const { rows } = await this.pool.query(
      `SELECT ${ACCOUNT_COLS} FROM financial_accounts WHERE id = $1 AND "orgId" = $2`,
      [id, orgId],
    );
    if (rows.length === 0) throw new NotFoundException(`conta ${id} não encontrada`);
    return rows[0];
  }

  // -- Receivables ---------------------------------------------------------

  async createReceivable(orgId: string, dto: CreateReceivableDto) {
    if (dto.sourceType === 'INVOICE' && !dto.sourceId) {
      throw new BadRequestException('recebível INVOICE exige source_id (billing.Invoice.id)');
    }
    // Condicional "quando INVOICE" do UNIQUE(sourceType, sourceId):
    // MANUAL sem sourceId recebe `manual:<uuid>` (nunca colide).
    const sourceId = dto.sourceId ?? (dto.sourceType === 'MANUAL' ? `manual:${randomUUID()}` : null);
    if (sourceId) {
      const { rows } = await this.pool.query(
        `SELECT ${RECEIVABLE_COLS} FROM receivables WHERE "sourceType" = $1 AND "sourceId" = $2 AND "orgId" = $3`,
        [dto.sourceType, sourceId, orgId],
      );
      if (rows.length > 0) return rows[0]; // replay: mesma origem → mesmo título
    }
    if (dto.categoryId) await this.requireCategory(orgId, dto.categoryId, 'INCOME');
    const { rows } = await this.pool.query(
      `INSERT INTO receivables (id, "orgId", "sourceType", "sourceId", "categoryId", "amountCents", "dueDate", status, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
       RETURNING ${RECEIVABLE_COLS}`,
      [
        randomUUID(), orgId, dto.sourceType, sourceId, dto.categoryId ?? null,
        dto.amountCents, dto.dueDate, dto.status ?? 'PREVISTO',
      ],
    );
    return rows[0];
  }

  async listReceivables(orgId: string, filters: { status?: string; from?: string; to?: string; limit?: number }) {
    const conds = [`"orgId" = $1`];
    const params: unknown[] = [orgId];
    if (filters.status) {
      params.push(filters.status);
      conds.push(`status = $${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from);
      conds.push(`"dueDate" >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      conds.push(`"dueDate" <= $${params.length}`);
    }
    const { rows } = await this.pool.query(
      `SELECT ${RECEIVABLE_COLS} FROM receivables WHERE ${conds.join(' AND ')} ORDER BY "dueDate", id` +
        (filters.limit ? ` LIMIT ${Math.min(filters.limit, 500)}` : ``),
      params,
    );
    return rows;
  }

  async getReceivable(orgId: string, id: string) {
    const { rows } = await this.pool.query(
      `SELECT ${RECEIVABLE_COLS} FROM receivables WHERE id = $1 AND "orgId" = $2`,
      [id, orgId],
    );
    if (rows.length === 0) throw new NotFoundException(`recebível ${id} não encontrado`);
    return rows[0];
  }

  /**
   * Baixa de recebimento (idempotente). `Idempotency-Key` é OBRIGATÓRIA
   * (mín. 8 chars) — sem ela cada retry gerava chave nova e não deduplicava.
   * Replay do mesmo idempotencyKey — ou de um título já RECEBIDO — retorna
   * `{ receivable, transaction }` existentes, sem duplicar Transaction, sem
   * remexer saldo, sem reemitir outbox. Sucesso: RECEBIDO + Transaction
   * INCOME + saldo += valor + outbox, tudo na mesma txn.
   *
   * Guarda de concorrência: o `check()` roda FORA da txn, então duas
   * requests com chaves DIFERENTES podem passar nele juntas. O
   * `AND status <> 'RECEBIDO'` no WHERE é o backstop atômico — o perdedor
   * da race casa 0 linhas, volta via ROLLBACK e devolve o estado
   * vencedor (replay), nunca 500 e nunca 2 Transaction para o mesmo título.
   */
  async markReceived(orgId: string, id: string, dto: MarkReceivedDto, idempotencyKey: string) {
    const key = requireIdempotencyKey(idempotencyKey);
    // Replay pela chave: mesma baixa, sem duplicar.
    const replay = await this.findTransactionByKey(orgId, key);
    if (replay) {
      const receivable = await this.getReceivable(orgId, id);
      return { receivable, transaction: replay };
    }
    const current = await this.getReceivable(orgId, id);
    if (current.status === 'RECEBIDO') {
      const transaction = await this.findTransactionByReceivable(orgId, id);
      return { receivable: current, transaction };
    }
    this.check('receivable', current.status, 'RECEBIDO', { receivableId: id });
    const account = await this.getAccount(orgId, dto.accountId);
    if (!account.active) {
      throw new UnprocessableEntityException('baixa exige conta ativa');
    }
    if (current.categoryId) await this.requireCategory(orgId, current.categoryId, 'INCOME');
    const categoryId = current.categoryId ?? (await this.defaultCategory(orgId, 'INCOME')).id;
    const provider = dto.provider ?? 'MANUAL';
    const externalId = dto.externalId ?? `manual:${randomUUID()}`;
    const occurredAt = dto.receivedAt ?? new Date().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Guarda de status no WHERE (backstop atômico da corrida): o título
      // só é baixado se ainda não estiver RECEBIDO no momento do lock.
      const { rows: recRows } = await client.query(
        `UPDATE receivables SET status = 'RECEBIDO', "receivedAt" = $3, "accountId" = $4, "updatedAt" = now()
         WHERE id = $1 AND "orgId" = $2 AND status <> 'RECEBIDO' RETURNING ${RECEIVABLE_COLS}`,
        [id, orgId, occurredAt, dto.accountId],
      );
      if (recRows.length === 0) {
        // Perdedor da race (outra baixa já RECEBIDO): desfaz e devolve o
        // estado vencedor — replay idempotente, sem 2ª Transaction.
        await client.query('ROLLBACK');
        const receivable = await this.getReceivable(orgId, id);
        const transaction = await this.findTransactionByReceivable(orgId, id);
        return { receivable, transaction };
      }
      const { rows: txnRows } = await client.query(
        `INSERT INTO financial_transactions (id, "orgId", "accountId", "categoryId", kind, "amountCents",
           "occurredAt", "receivableId", provider, "externalId", "idempotencyKey", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,'INCOME',$5,$6,$7,$8,$9,$10,now(),now())
         ON CONFLICT ("idempotencyKey") DO NOTHING
         RETURNING ${TXN_COLS}`,
        [
          randomUUID(), orgId, dto.accountId, categoryId, current.amountCents,
          occurredAt, id, provider, externalId, key,
        ],
      );
      let transaction = txnRows[0] ?? null;
      if (!transaction) {
        // Race no idempotencyKey: desfaz e retorna o existente (replay).
        await client.query('ROLLBACK');
        const existing = await this.findTransactionByKey(orgId, key);
        const receivable = await this.getReceivable(orgId, id);
        return { receivable, transaction: existing };
      }
      // ÚNICO ponto de mutação de saldo no domínio (REGRA DE OURO).
      await client.query(
        `UPDATE financial_accounts SET "balanceCents" = "balanceCents" + $3, "updatedAt" = now()
         WHERE id = $1 AND "orgId" = $2`,
        [dto.accountId, orgId, current.amountCents],
      );
      await this.insertOutbox(client, orgId, 'Receivable', id, 'finance.receivable.received.v1', {
        receivableId: id,
        transactionId: transaction.id,
        accountId: dto.accountId,
        amountCents: current.amountCents,
        receivedAt: occurredAt,
      });
      await client.query('COMMIT');
      return { receivable: recRows[0], transaction };
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      if (isUniqueViolation(e)) throw new ConflictException('transação já registrada (provider/externalId em uso)');
      throw e;
    } finally {
      client.release();
    }
  }

  // -- Payables ------------------------------------------------------------

  async createPayable(orgId: string, dto: CreatePayableDto) {
    if ((dto.sourceType === 'REFUND' || dto.sourceType === 'SUPPLIER') && !dto.sourceId) {
      throw new BadRequestException(`pagável ${dto.sourceType} exige source_id`);
    }
    const sourceId = dto.sourceId ?? `manual:${randomUUID()}`;
    const { rows: dup } = await this.pool.query(
      `SELECT ${PAYABLE_COLS} FROM payables WHERE "sourceType" = $1 AND "sourceId" = $2 AND "orgId" = $3`,
      [dto.sourceType, sourceId, orgId],
    );
    if (dup.length > 0) return dup[0]; // replay
    if (dto.categoryId) await this.requireCategory(orgId, dto.categoryId, 'EXPENSE');
    const { rows } = await this.pool.query(
      `INSERT INTO payables (id, "orgId", "sourceType", "sourceId", "categoryId", "amountCents", "dueDate", status, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
       RETURNING ${PAYABLE_COLS}`,
      [
        randomUUID(), orgId, dto.sourceType, sourceId, dto.categoryId ?? null,
        dto.amountCents, dto.dueDate, dto.status ?? 'PREVISTO',
      ],
    );
    return rows[0];
  }

  async listPayables(orgId: string, filters: { status?: string; from?: string; to?: string; limit?: number }) {
    const conds = [`"orgId" = $1`];
    const params: unknown[] = [orgId];
    if (filters.status) {
      params.push(filters.status);
      conds.push(`status = $${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from);
      conds.push(`"dueDate" >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      conds.push(`"dueDate" <= $${params.length}`);
    }
    const { rows } = await this.pool.query(
      `SELECT ${PAYABLE_COLS} FROM payables WHERE ${conds.join(' AND ')} ORDER BY "dueDate", id` +
        (filters.limit ? ` LIMIT ${Math.min(filters.limit, 500)}` : ``),
      params,
    );
    return rows;
  }

  async getPayable(orgId: string, id: string) {
    const { rows } = await this.pool.query(
      `SELECT ${PAYABLE_COLS} FROM payables WHERE id = $1 AND "orgId" = $2`,
      [id, orgId],
    );
    if (rows.length === 0) throw new NotFoundException(`pagável ${id} não encontrado`);
    return rows[0];
  }

  /**
   * Baixa de pagamento (idempotente, espelho de markReceived).
   * `Idempotency-Key` obrigatória (mín. 8 chars) + guarda de concorrência
   * `AND status <> 'PAGO'` no WHERE — mesmo backstop atômico de
   * `markReceived`: o perdedor da race casa 0 linhas e devolve o estado
   * vencedor via ROLLBACK.
   * Sucesso: PAGO + Transaction EXPENSE + saldo -= valor + outbox, mesma txn.
   */
  async markPaid(orgId: string, id: string, dto: MarkPaidDto, idempotencyKey: string) {
    const key = requireIdempotencyKey(idempotencyKey);
    const replay = await this.findTransactionByKey(orgId, key);
    if (replay) {
      const payable = await this.getPayable(orgId, id);
      return { payable, transaction: replay };
    }
    const current = await this.getPayable(orgId, id);
    if (current.status === 'PAGO') {
      const transaction = await this.findTransactionByPayable(orgId, id);
      return { payable: current, transaction };
    }
    this.check('payable', current.status, 'PAGO', { payableId: id });
    const account = await this.getAccount(orgId, dto.accountId);
    if (!account.active) {
      throw new UnprocessableEntityException('baixa exige conta ativa');
    }
    if (current.categoryId) await this.requireCategory(orgId, current.categoryId, 'EXPENSE');
    const categoryId = current.categoryId ?? (await this.defaultCategory(orgId, 'EXPENSE')).id;
    const provider = dto.provider ?? 'MANUAL';
    const externalId = dto.externalId ?? `manual:${randomUUID()}`;
    const occurredAt = dto.paidAt ?? new Date().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Guarda de status no WHERE (backstop atômico da corrida).
      const { rows: payRows } = await client.query(
        `UPDATE payables SET status = 'PAGO', "paidAt" = $3, "accountId" = $4, "updatedAt" = now()
         WHERE id = $1 AND "orgId" = $2 AND status <> 'PAGO' RETURNING ${PAYABLE_COLS}`,
        [id, orgId, occurredAt, dto.accountId],
      );
      if (payRows.length === 0) {
        // Perdedor da race: devolve o estado vencedor, sem 2ª Transaction
        // e sem tocar o saldo.
        await client.query('ROLLBACK');
        const payable = await this.getPayable(orgId, id);
        const transaction = await this.findTransactionByPayable(orgId, id);
        return { payable, transaction };
      }
      const { rows: txnRows } = await client.query(
        `INSERT INTO financial_transactions (id, "orgId", "accountId", "categoryId", kind, "amountCents",
           "occurredAt", "payableId", provider, "externalId", "idempotencyKey", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,'EXPENSE',$5,$6,$7,$8,$9,$10,now(),now())
         ON CONFLICT ("idempotencyKey") DO NOTHING
         RETURNING ${TXN_COLS}`,
        [
          randomUUID(), orgId, dto.accountId, categoryId, current.amountCents,
          occurredAt, id, provider, externalId, key,
        ],
      );
      let transaction = txnRows[0] ?? null;
      if (!transaction) {
        await client.query('ROLLBACK');
        const existing = await this.findTransactionByKey(orgId, key);
        const payable = await this.getPayable(orgId, id);
        return { payable, transaction: existing };
      }
      // ÚNICO ponto de mutação de saldo no domínio (REGRA DE OURO).
      await client.query(
        `UPDATE financial_accounts SET "balanceCents" = "balanceCents" - $3, "updatedAt" = now()
         WHERE id = $1 AND "orgId" = $2`,
        [dto.accountId, orgId, current.amountCents],
      );
      await this.insertOutbox(client, orgId, 'Payable', id, 'finance.payable.paid.v1', {
        payableId: id,
        transactionId: transaction.id,
        accountId: dto.accountId,
        amountCents: current.amountCents,
        paidAt: occurredAt,
      });
      await client.query('COMMIT');
      return { payable: payRows[0], transaction };
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      if (isUniqueViolation(e)) throw new ConflictException('transação já registrada (provider/externalId em uso)');
      throw e;
    } finally {
      client.release();
    }
  }

  // -- Transactions (extrato realizado) --------------------------------------

  async listTransactions(
    orgId: string,
    filters: { accountId?: string; kind?: string; from?: string; to?: string; limit?: number },
  ) {
    const conds = [`"orgId" = $1`];
    const params: unknown[] = [orgId];
    if (filters.accountId) {
      params.push(filters.accountId);
      conds.push(`"accountId" = $${params.length}`);
    }
    if (filters.kind) {
      params.push(filters.kind);
      conds.push(`kind = $${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from);
      conds.push(`"occurredAt" >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      conds.push(`"occurredAt" <= $${params.length}`);
    }
    const { rows } = await this.pool.query(
      `SELECT ${TXN_COLS} FROM financial_transactions WHERE ${conds.join(' AND ')} ORDER BY "occurredAt" DESC, id DESC` +
        (filters.limit ? ` LIMIT ${Math.min(filters.limit ?? 200, 500)}` : ` LIMIT 200`),
      params,
    );
    return rows;
  }

  // -- Overview (previsto/pendente/realizado + inadimplência) ----------------

  /**
   * Visão agregada por período (filtro por dueDate). Buckets por status;
   * CANCELADO sai dos buckets (soma separada p/ auditoria). Inadimplência:
   * soma INADIMPLENTE + taxa sobre o total a receber do período
   * (previsto+pendente+recebido+inadimplente). CANCELADO fora da base.
   */
  async overview(orgId: string, from?: string, to?: string) {
    const range: string[] = [];
    const params: unknown[] = [orgId];
    if (from) {
      params.push(from);
      range.push(`"dueDate" >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      range.push(`"dueDate" <= $${params.length}`);
    }
    const where = (alias: string) =>
      `${alias}."orgId" = $1` + (range.length > 0 ? ` AND ${range.map((r) => `${alias}.${r}`).join(' AND ')}` : ``);
    const { rows: recRows } = await this.pool.query(
      `SELECT status, COALESCE(SUM("amountCents"),0)::bigint AS total, COUNT(*)::int AS qty
       FROM receivables r WHERE ${where('r')} GROUP BY status`,
      params,
    );
    const { rows: payRows } = await this.pool.query(
      `SELECT status, COALESCE(SUM("amountCents"),0)::bigint AS total, COUNT(*)::int AS qty
       FROM payables p WHERE ${where('p')} GROUP BY status`,
      params,
    );
    const { rows: accounts } = await this.pool.query(
      `SELECT id, code, type, "balanceCents" FROM financial_accounts WHERE "orgId" = $1 ORDER BY code`,
      [orgId],
    );
    const bucket = (rows: Array<{ status: string; total: string; qty: number }>, statuses: string[]) =>
      rows
        .filter((r) => statuses.includes(r.status))
        .reduce((acc, r) => acc + Number(r.total), 0);
    const receivables = {
      previstoCents: bucket(recRows, ['PREVISTO']),
      pendenteCents: bucket(recRows, ['PENDENTE']),
      realizadoCents: bucket(recRows, ['RECEBIDO']),
      inadimplenteCents: bucket(recRows, ['INADIMPLENTE']),
      canceladoCents: bucket(recRows, ['CANCELADO']),
    };
    const payables = {
      previstoCents: bucket(payRows, ['PREVISTO']),
      pendenteCents: bucket(payRows, ['PENDENTE']),
      realizadoCents: bucket(payRows, ['PAGO']),
      canceladoCents: bucket(payRows, ['CANCELADO']),
    };
    const base =
      receivables.previstoCents + receivables.pendenteCents + receivables.realizadoCents + receivables.inadimplenteCents;
    const totalBalanceCents = accounts.reduce((acc: number, a: { balanceCents: number }) => acc + a.balanceCents, 0);
    return {
      period: { from: from ?? null, to: to ?? null },
      receivables: {
        ...receivables,
        delinquencyRate: base > 0 ? Number((receivables.inadimplenteCents / base).toFixed(4)) : 0,
      },
      payables,
      net: {
        previstoCents: receivables.previstoCents - payables.previstoCents,
        pendenteCents: receivables.pendenteCents - payables.pendenteCents,
        realizadoCents: receivables.realizadoCents - payables.realizadoCents,
      },
      accounts,
      totalBalanceCents,
    };
  }

  // -- Privados --------------------------------------------------------------

  private async requireCategory(orgId: string, categoryId: string, expectedType: string) {
    const { rows } = await this.pool.query(
      `SELECT ${CATEGORY_COLS} FROM financial_categories WHERE id = $1 AND "orgId" = $2`,
      [categoryId, orgId],
    );
    if (rows.length === 0) throw new NotFoundException(`categoria ${categoryId} não encontrada`);
    if (!rows[0].active) throw new UnprocessableEntityException('categoria inativa');
    if (rows[0].type !== expectedType) {
      throw new UnprocessableEntityException(`categoria ${categoryId} é ${rows[0].type}, esperado ${expectedType}`);
    }
    return rows[0];
  }

  private async defaultCategory(orgId: string, type: string) {
    const code = type === 'INCOME' ? 'RECEITA_AVULSA' : 'DESPESA_AVULSA';
    const { rows } = await this.pool.query(
      `INSERT INTO financial_categories (id, "orgId", code, name, type, active, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,true,now(),now())
       ON CONFLICT ("orgId", code) DO NOTHING
       RETURNING ${CATEGORY_COLS}`,
      [randomUUID(), orgId, code, type === 'INCOME' ? 'Receita avulsa' : 'Despesa avulsa', type],
    );
    if (rows.length > 0) return rows[0];
    const { rows: existing } = await this.pool.query(
      `SELECT ${CATEGORY_COLS} FROM financial_categories WHERE "orgId" = $1 AND code = $2`,
      [orgId, code],
    );
    return existing[0];
  }

  private async findTransactionByKey(orgId: string, key: string) {
    const { rows } = await this.pool.query(
      `SELECT ${TXN_COLS} FROM financial_transactions WHERE "idempotencyKey" = $1 AND "orgId" = $2`,
      [key, orgId],
    );
    return rows[0] ?? null;
  }

  private async findTransactionByReceivable(orgId: string, receivableId: string) {
    const { rows } = await this.pool.query(
      `SELECT ${TXN_COLS} FROM financial_transactions WHERE "receivableId" = $1 AND "orgId" = $2 ORDER BY "createdAt" DESC LIMIT 1`,
      [receivableId, orgId],
    );
    return rows[0] ?? null;
  }

  private async findTransactionByPayable(orgId: string, payableId: string) {
    const { rows } = await this.pool.query(
      `SELECT ${TXN_COLS} FROM financial_transactions WHERE "payableId" = $1 AND "orgId" = $2 ORDER BY "createdAt" DESC LIMIT 1`,
      [payableId, orgId],
    );
    return rows[0] ?? null;
  }

  private async insertOutbox(
    client: PoolClient,
    orgId: string,
    aggregate: string,
    aggregateId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO finance_outbox (id, "eventId", "orgId", aggregate, "aggregateId", type, payload, "occurredAt", published, "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,now(),false,now())`,
      [randomUUID(), eventId, orgId, aggregate, aggregateId, type, JSON.stringify(payload)],
    );
    return eventId;
  }
}
