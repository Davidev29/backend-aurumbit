import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { maskBarcode, normalizeBarcode } from './barcode';
import { CreateAutoReceivableDto, CreateExpenseDto } from './finance-automation.dto';
import { FINANCE_AUTOMATION_PROVIDER, FinanceAutomationProvider } from './finance-automation.provider';
import {
  FINANCE_AUTOMATION_QUEUE_PORT,
  FinanceAutomationQueuePort,
  autoChargeJobOptions,
  billPayJobOptions,
} from './finance-automation.queue';
import { FINANCE_POOL } from './finance-pool.provider';
import { FinanceNotificationsService } from './finance-notifications.service';
import { FinanceService } from './finance.service';

// Orquestrador da automação financeira (despesas + receitas).
//
// Fluxo agêntico (estabilidade/robustez/idempotência, PROJECT.md §5):
// 1. valida entrada (puro: barcode, datas) — 4xx antes de qualquer escrita;
// 2. cria o título canônico (Payable SUPPLIER / Receivable MANUAL) via
//    FinanceService — replay pela origem retorna o existente, sem duplicar;
// 3. registra o job de automação `UNIQUE(idempotencyKey)` — replay retorna o
//    existente sem reexecutar o provider;
// 4. chama o provider (Asaas) FORA de transação PG (nunca segura txn em I/O);
// 5. persiste o resultado + notificação in-system idempotente por eventId;
// 6. falha transitória → job FAILED + throw (worker retry exponencial 5x +
//    DLQ preservando o id); falha de negócio (barcode fora do Bill Payments)
//    → job CANCELED + notificação WARN, sem retry (título manual preservado).
//
// REGRA DE OURO preservada: este service NUNCA toca em
// `financial_accounts.balanceCents` (só `markPaid`/`markReceived` via
// FinancialTransaction).

export type AutomationJobStatus =
  | 'QUEUED'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'DONE'
  | 'FAILED'
  | 'CANCELED';

export interface AutomationJob {
  id: string;
  idempotencyKey: string;
  orgId: string;
  kind: 'BILL_PAY' | 'AUTO_CHARGE';
  payableId: string | null;
  receivableId: string | null;
  barcodeMasked: string | null;
  scheduleDate: string | null;
  provider: string;
  externalId: string | null;
  status: AutomationJobStatus;
  attempts: number;
  lastError: string | null;
}

const JOB_COLS = `id, "idempotencyKey", "orgId", kind, "payableId", "receivableId", "barcodeMasked",
  "scheduleDate", provider, "externalId", status, attempts, "lastError", "createdAt", "updatedAt"`;

function todayISO(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function isOverdue(dueDate: string, nowMs = Date.now()): boolean {
  return dueDate.slice(0, 10) < todayISO(nowMs);
}

@Injectable()
export class FinanceAutomationService {
  private readonly logger = new Logger(FinanceAutomationService.name);

  constructor(
    @Inject(FINANCE_POOL) private readonly pool: Pool,
    private readonly finance: FinanceService,
    private readonly notifications: FinanceNotificationsService,
    @Inject(FINANCE_AUTOMATION_PROVIDER) private readonly provider: FinanceAutomationProvider,
    private readonly audit: AuditService,
    @Optional() @Inject(FINANCE_AUTOMATION_QUEUE_PORT) private readonly queue?: FinanceAutomationQueuePort,
  ) {}

  // -- Despesas ----------------------------------------------------------

  /**
   * Cria a despesa e, quando solicitado e suportado, paga via Asaas
   * (Bill Payments) com agendamento automático.
   * Idempotente pela `Idempotency-Key`: replay retorna `{ payable, job,
   * duplicate: true }` sem recriar título nem rechamar o provider.
   */
  async createExpense(
    orgId: string,
    dto: CreateExpenseDto,
    idempotencyKey: string,
    actorId?: string,
  ): Promise<{ payable: unknown; job: AutomationJob | null; duplicate: boolean; viaAsaas: boolean }> {
    if (!idempotencyKey || idempotencyKey.length < 8) {
      throw new BadRequestException('Idempotency-Key obrigatória (mín. 8 chars).');
    }
    const existingJob = await this.findJob(orgId, idempotencyKey);
    if (existingJob?.kind === 'BILL_PAY') {
      const payable = await this.finance.getPayable(orgId, String(existingJob.payableId));
      return { payable, job: existingJob, duplicate: true, viaAsaas: existingJob.status !== 'CANCELED' };
    }

    // 1. Validação pura antes de qualquer escrita.
    let barcodeDigits: string | null = null;
    let barcodeMasked: string | null = null;
    if (dto.barcode) {
      try {
        barcodeDigits = normalizeBarcode(dto.barcode);
        barcodeMasked = maskBarcode(barcodeDigits);
      } catch (e) {
        throw new UnprocessableEntityException(
          e instanceof Error ? e.message : 'código de barras inválido',
        );
      }
    }
    const due = dto.dueDate.slice(0, 10);
    const schedule = (dto.scheduleDate ?? dto.dueDate).slice(0, 10);
    const overdue = isOverdue(dto.dueDate);
    const wantAsaas = dto.payViaAsaas === true;
    const supported = barcodeDigits != null && (barcodeDigits.length === 47 || barcodeDigits.length === 48);
    const viaAsaas = wantAsaas && supported;

    // 2. Título canônico (replay pela origem `expense:<key>`).
    const payable = await this.finance.createPayable(orgId, {
      sourceType: 'SUPPLIER',
      sourceId: `expense:${idempotencyKey}`,
      categoryId: dto.categoryId,
      amountCents: dto.amountCents,
      dueDate: dto.dueDate,
      status: overdue ? 'PENDENTE' : 'PREVISTO',
    } as never);

    // Sem automação Asaas: só notifica a criação manual.
    if (!wantAsaas || barcodeDigits == null) {
      await this.notifications.notify({
        orgId,
        eventId: `finance:expense.manual:${idempotencyKey}`,
        kind: 'EXPENSE_CREATED',
        title: `Despesa criada — ${(payable as { id: string }).id}`,
        body: wantAsaas && barcodeDigits == null
          ? 'Sem código de barras: pagamento manual. Adicione o boleto p/ pagar via Asaas.'
          : `Vencimento ${due}. Baixa manual em /financeiro.`,
        severity: 'INFO',
      });
      this.audit.emit({
        actorId,
        action: 'finance.expense.created',
        entity: 'payable',
        entityId: (payable as { id: string }).id,
        metadata: { orgId, amountCents: dto.amountCents, viaAsaas: false },
      });
      return { payable, job: null, duplicate: false, viaAsaas: false };
    }

    // 3. Job idempotente (dedupe antes do provider).
    const job = await this.claimJob({
      idempotencyKey,
      orgId,
      kind: 'BILL_PAY',
      payableId: (payable as { id: string }).id,
      barcodeMasked,
      scheduleDate: overdue ? todayISO() : schedule,
    });
    if (job.status === 'DONE' || job.status === 'SCHEDULED') {
      return { payable, job, duplicate: true, viaAsaas: true };
    }
    if (job.status !== 'QUEUED') {
      // Race (duplo clique / retry concorrente): o vencedor executa; aqui só reflete.
      return { payable, job, duplicate: true, viaAsaas: job.status !== 'CANCELED' };
    }

    // 4. Fora do Bill Payments → fallback manual (sem retry, sem erro).
    if (!supported) {
      await this.setJob(job.id, orgId, 'CANCELED', 'fora do Bill Payments Asaas (só boleto 47 / convênio 48 dígitos)');
      await this.notifications.notify({
        orgId,
        eventId: `finance:expense.unsupported:${idempotencyKey}`,
        kind: 'EXPENSE_UNSUPPORTED',
        title: 'Despesa fora do pagamento via Asaas',
        body: 'Código de barras fora do Bill Payments (só boleto 47 / convênio 48). Siga com pagamento manual.',
        severity: 'WARN',
      });
      return { payable, job: { ...job, status: 'CANCELED' }, duplicate: false, viaAsaas: false };
    }

    // 5. Posse atômica da tentativa (CAS QUEUED→RUNNING): fecha a race de
    // duplo clique / workers concorrentes — só um executor chama o provider.
    const owned = await this.claimForAttempt(job.id, orgId);
    if (!owned) {
      const current = (await this.findJob(orgId, idempotencyKey)) ?? job;
      return { payable, job: current, duplicate: true, viaAsaas: current.status !== 'CANCELED' };
    }
    const attempt = await this.attemptBillPay({
      orgId,
      job,
      payableId: (payable as { id: string }).id,
      barcodeDigits,
      scheduleDate: overdue ? todayISO() : schedule,
      description: dto.description,
      actorId,
      idempotencyKey,
    });
    return { payable, ...attempt };
  }

  /**
   * Replay interno (worker `finance.bill-pay`, `x-internal-key`).
   * Idempotente: DONE/SCHEDULED/CANCELED → `{ duplicate: true }` sem
   * rechamar o provider. Payload (barcode) viaja no job-data (Redis,
   * efêmero) — no PG guardamos só a máscara.
   */
  async replayBillPay(
    orgId: string,
    input: { idempotencyKey: string; barcode?: string; scheduleDate?: string; description?: string },
    actorId?: string,
  ): Promise<{ job: AutomationJob; duplicate: boolean }> {
    const job = await this.findJob(orgId, input.idempotencyKey);
    if (!job || job.kind !== 'BILL_PAY' || !job.payableId) {
      throw new BadRequestException('job bill-pay não encontrado p/ replay');
    }
    if (job.status === 'DONE' || job.status === 'SCHEDULED' || job.status === 'CANCELED') {
      return { job, duplicate: true };
    }
    if (!input.barcode) {
      await this.setJob(job.id, orgId, 'FAILED', 'replay sem barcode (poison: sem payload p/ reexecutar)');
      throw new BadRequestException('replay sem barcode (poison)');
    }
    let barcodeDigits: string;
    try {
      barcodeDigits = normalizeBarcode(input.barcode);
    } catch (e) {
      await this.setJob(job.id, orgId, 'CANCELED', e instanceof Error ? e.message : 'barcode inválido');
      throw new BadRequestException(e instanceof Error ? e.message : 'barcode inválido');
    }
    if (barcodeDigits.length !== 47 && barcodeDigits.length !== 48) {
      await this.setJob(job.id, orgId, 'CANCELED', 'fora do Bill Payments Asaas');
      throw new BadRequestException('fora do Bill Payments Asaas (poison)');
    }
    const owned = await this.claimForAttempt(job.id, orgId);
    if (!owned) {
      const current = (await this.findJob(orgId, input.idempotencyKey)) ?? job;
      return { job: current, duplicate: true };
    }
    const out = await this.attemptBillPay({
      orgId,
      job: { ...job, status: 'RUNNING' },
      payableId: job.payableId,
      barcodeDigits,
      scheduleDate: (input.scheduleDate ?? job.scheduleDate ?? todayISO()).slice(0, 10),
      description: input.description,
      actorId,
      idempotencyKey: input.idempotencyKey,
    });
    return { job: out.job, duplicate: false };
  }

  private async attemptBillPay(input: {    orgId: string;
    job: AutomationJob;
    payableId: string;
    barcodeDigits: string;
    scheduleDate: string;
    description?: string;
    actorId?: string;
    idempotencyKey: string;
  }): Promise<{ payable?: unknown; job: AutomationJob; duplicate: boolean; viaAsaas: boolean }> {
    const { orgId, job, payableId, barcodeDigits, actorId, idempotencyKey } = input;
    const barcodeMasked = maskBarcode(barcodeDigits);
    // Vencido ou data alcançada → imediato (regra Asaas: vencido não agenda).
    const immediate = input.scheduleDate <= todayISO();
    const schedule = immediate ? todayISO() : input.scheduleDate;
    try {
      const bill = await this.provider.createBillPayment({
        identificationField: barcodeDigits,
        scheduleDate: schedule,
        description: input.description ?? `Despesa ${payableId}`,
        externalReference: payableId,
      });
      await this.pool.query(
        `UPDATE payables SET provider = 'ASAAS', "externalId" = $3 WHERE id = $1 AND "orgId" = $2`,
        [payableId, orgId, bill.id],
      );
      const done = await this.setJob(job.id, orgId, immediate ? 'DONE' : 'SCHEDULED', null, bill.id);
      await this.notifications.notify({
        orgId,
        eventId: `finance:bill-pay:${idempotencyKey}`,
        kind: immediate ? 'BILL_PAID' : 'BILL_SCHEDULED',
        title: immediate ? 'Boleto pago via Asaas' : `Pagamento agendado via Asaas p/ ${schedule}`,
        body: `Conta ${payableId} (${barcodeMasked}). Baixa automática na confirmação (webhook BILL_PAID).`,
        severity: 'INFO',
      });
      this.audit.emit({
        actorId,
        action: 'finance.expense.bill_scheduled',
        entity: 'payable',
        entityId: payableId,
        metadata: { orgId, billId: bill.id, scheduleDate: schedule },
      });
      return { job: done, duplicate: false, viaAsaas: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const retryable = e instanceof ServiceUnavailableException || /HTTP (408|425|429|500|502|503|504)|rede\/timeout/i.test(message);
      await this.setJob(job.id, orgId, 'FAILED', message.slice(0, 500));
      await this.notifications.notify({
        orgId,
        eventId: `finance:bill-pay.failed:${idempotencyKey}`,
        kind: 'BILL_PAY_FAILED',
        title: 'Falha no pagamento via Asaas',
        body: retryable
          ? `Será repetido automaticamente (fila). Título preservado p/ baixa manual. Erro: ${message.slice(0, 140)}`
          : `Sem nova tentativa automática. Pague manual e baixe em /financeiro. Erro: ${message.slice(0, 140)}`,
        severity: 'ERROR',
      });
      this.logger.warn(JSON.stringify({ event: 'finance.bill_pay_failed', payableId, message: message.slice(0, 200) }));
      if (retryable) {
        // Follow-up agêntico: worker reexecuta via endpoint interno
        // idempotente (jobId = chave; CAS fecha a race). Nunca quebra a
        // resposta — o inline já registrou FAILED + notificação.
        await this.enqueueFollowUp('finance.bill-pay', {
          orgId,
          idempotencyKey,
          barcode: barcodeDigits,
          scheduleDate: schedule,
          description: input.description,
        });
        throw e; // worker: retry exponencial + DLQ
      }
      throw new UnprocessableEntityException(`pagamento via Asaas recusado: ${message.slice(0, 200)}`);
    }
  }

  async getExpenseAutomation(orgId: string, payableId: string): Promise<AutomationJob | null> {
    const { rows } = await this.pool.query(
      `SELECT ${JOB_COLS} FROM finance_automation_jobs WHERE "orgId" = $1 AND "payableId" = $2 ORDER BY "createdAt" DESC LIMIT 1`,
      [orgId, payableId],
    );
    return (rows[0] as unknown as AutomationJob) ?? null;
  }

  // -- Receitas (cobrança automática) ------------------------------------

  /**
   * Cria o recebível e emite a cobrança Asaas automaticamente
   * (PIX/BOLETO). Retorna a linha digitável quando o Asaas a fornece.
   * Idempotente pela `Idempotency-Key` (replay sem duplicar nem recobrar).
   */
  async createReceivableAuto(
    orgId: string,
    dto: CreateAutoReceivableDto,
    idempotencyKey: string,
    actorId?: string,
  ): Promise<{
    receivable: unknown;
    job: AutomationJob;
    duplicate: boolean;
    chargeId: string | null;
    identificationField: string | null;
  }> {
    if (!idempotencyKey || idempotencyKey.length < 8) {
      throw new BadRequestException('Idempotency-Key obrigatória (mín. 8 chars).');
    }
    const existingJob = await this.findJob(orgId, idempotencyKey);
    if (existingJob?.kind === 'AUTO_CHARGE') {
      const receivable = await this.finance.getReceivable(orgId, String(existingJob.receivableId));
      return {
        receivable,
        job: existingJob,
        duplicate: true,
        chargeId: existingJob.externalId,
        identificationField: null,
      };
    }
    const receivable = await this.finance.createReceivable(orgId, {
      sourceType: 'MANUAL',
      sourceId: `auto-charge:${idempotencyKey}`,
      categoryId: dto.categoryId,
      amountCents: dto.amountCents,
      dueDate: dto.dueDate,
      status: 'PENDENTE',
    } as never);

    const job = await this.claimJob({
      idempotencyKey,
      orgId,
      kind: 'AUTO_CHARGE',
      receivableId: (receivable as { id: string }).id,
      scheduleDate: dto.dueDate.slice(0, 10),
    });
    if (job.status === 'DONE') {
      return { receivable, job, duplicate: true, chargeId: job.externalId, identificationField: null };
    }
    const owned = await this.claimForAttempt(job.id, orgId);
    if (!owned) {
      const current = (await this.findJob(orgId, idempotencyKey)) ?? job;
      return { receivable, job: current, duplicate: true, chargeId: current.externalId, identificationField: null };
    }
    const attempt = await this.attemptAutoCharge({
      orgId,
      job: { ...job, status: 'RUNNING' },
      receivableId: (receivable as { id: string }).id,
      asaasCustomerId: dto.asaasCustomerId,
      customerName: dto.customerName,
      amountCents: dto.amountCents,
      dueDate: dto.dueDate,
      billingType: dto.billingType,
      description: dto.description,
      actorId,
      idempotencyKey,
    });
    return { receivable, ...attempt };
  }

  /**
   * Replay interno (worker `finance.auto-charge`, `x-internal-key`).
   * Idempotente: DONE → `{ duplicate: true }`. Payload (customer Asaas)
   * viaja no job-data (Redis, efêmero).
   */
  async replayAutoCharge(
    orgId: string,
    input: {
      idempotencyKey: string;
      asaasCustomerId?: string;
      customerName?: string;
      amountCents?: number;
      dueDate?: string;
      billingType?: string;
      description?: string;
    },
    actorId?: string,
  ): Promise<{ job: AutomationJob; duplicate: boolean; chargeId: string | null }> {
    const job = await this.findJob(orgId, input.idempotencyKey);
    if (!job || job.kind !== 'AUTO_CHARGE' || !job.receivableId) {
      throw new BadRequestException('job auto-charge não encontrado p/ replay');
    }
    if (job.status === 'DONE') {
      return { job, duplicate: true, chargeId: job.externalId };
    }
    if (!input.asaasCustomerId || !input.amountCents || !input.dueDate) {
      await this.setJob(job.id, orgId, 'FAILED', 'replay sem payload (poison: asaasCustomerId/amountCents/dueDate)');
      throw new BadRequestException('replay sem payload (poison)');
    }
    const owned = await this.claimForAttempt(job.id, orgId);
    if (!owned) {
      const current = (await this.findJob(orgId, input.idempotencyKey)) ?? job;
      return { job: current, duplicate: true, chargeId: current.externalId };
    }
    const out = await this.attemptAutoCharge({
      orgId,
      job: { ...job, status: 'RUNNING' },
      receivableId: job.receivableId,
      asaasCustomerId: input.asaasCustomerId,
      customerName: input.customerName ?? 'cliente',
      amountCents: input.amountCents,
      dueDate: input.dueDate,
      billingType: input.billingType,
      description: input.description,
      actorId,
      idempotencyKey: input.idempotencyKey,
    });
    return { job: out.job, duplicate: false, chargeId: out.chargeId };
  }

  private async attemptAutoCharge(input: {
    orgId: string;
    job: AutomationJob;
    receivableId: string;
    asaasCustomerId: string;
    customerName: string;
    amountCents: number;
    dueDate: string;
    billingType?: string;
    description?: string;
    actorId?: string;
    idempotencyKey: string;
  }): Promise<{
    job: AutomationJob;
    duplicate: boolean;
    chargeId: string | null;
    identificationField: string | null;
  }> {
    const { orgId, job, receivableId, actorId, idempotencyKey } = input;
    try {
      const charge = await this.provider.createCharge({
        customerId: input.asaasCustomerId,
        valueCents: input.amountCents,
        dueDate: input.dueDate.slice(0, 10),
        billingType: input.billingType ?? 'UNDEFINED',
        description: input.description ?? `Recebível ${receivableId}`,
        externalReference: receivableId,
      });
      let identificationField: string | null = null;
      try {
        const idf = await this.provider.getChargeIdentificationField(charge.id);
        identificationField = idf.identificationField ?? idf.barCode;
      } catch {
        identificationField = null; // boleto/PIX sem linha ainda (webhook completa)
      }
      await this.pool.query(
        `UPDATE receivables SET provider = 'ASAAS', "externalId" = $3 WHERE id = $1 AND "orgId" = $2`,
        [receivableId, orgId, charge.id],
      );
      const done = await this.setJob(job.id, orgId, 'DONE', null, charge.id);
      await this.notifications.notify({
        orgId,
        eventId: `finance:auto-charge:${idempotencyKey}`,
        kind: 'CHARGE_ISSUED',
        title: `Cobrança automática emitida — ${input.customerName}`,
        body: identificationField
          ? `Linha digitável disponível. Vencimento ${input.dueDate.slice(0, 10)}. Baixa automática na confirmação.`
          : `Cobrança ${charge.id} emitida. Vencimento ${input.dueDate.slice(0, 10)}. Baixa automática na confirmação.`,
        severity: 'INFO',
      });
      this.audit.emit({
        actorId,
        action: 'finance.receivable.auto_charged',
        entity: 'receivable',
        entityId: receivableId,
        metadata: { orgId, chargeId: charge.id },
      });
      return { job: done, duplicate: false, chargeId: charge.id, identificationField };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.setJob(job.id, orgId, 'FAILED', message.slice(0, 500));
      await this.notifications.notify({
        orgId,
        eventId: `finance:auto-charge.failed:${idempotencyKey}`,
        kind: 'CHARGE_FAILED',
        title: 'Falha na cobrança automática',
        body: `Recebível preservado; a cobrança será repetida automaticamente. Erro: ${message.slice(0, 140)}`,
        severity: 'ERROR',
      });
      await this.enqueueFollowUp('finance.auto-charge', {
        orgId,
        idempotencyKey,
        asaasCustomerId: input.asaasCustomerId,
        customerName: input.customerName,
        amountCents: input.amountCents,
        dueDate: input.dueDate,
        billingType: input.billingType,
        description: input.description,
      });
      throw e; // worker: retry exponencial + DLQ
    }
  }

  async findJobByKey(orgId: string, idempotencyKey: string): Promise<AutomationJob | null> {
    return this.findJob(orgId, idempotencyKey);
  }

  // -- Privados ------------------------------------------------------------

  private async findJob(orgId: string, idempotencyKey: string): Promise<AutomationJob | null> {
    const { rows } = await this.pool.query(
      `SELECT ${JOB_COLS} FROM finance_automation_jobs WHERE "orgId" = $1 AND "idempotencyKey" = $2`,
      [orgId, idempotencyKey],
    );
    return (rows[0] as unknown as AutomationJob) ?? null;
  }

  private async claimJob(input: {
    idempotencyKey: string;
    orgId: string;
    kind: 'BILL_PAY' | 'AUTO_CHARGE';
    payableId?: string;
    receivableId?: string;
    barcodeMasked?: string | null;
    scheduleDate?: string | null;
  }): Promise<AutomationJob> {
    const { rows } = await this.pool.query(
      `INSERT INTO finance_automation_jobs (id, "idempotencyKey", "orgId", kind, "payableId", "receivableId",
        "barcodeMasked", "scheduleDate", provider, "externalId", status, attempts, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ASAAS',NULL,'QUEUED',0,now(),now())
       ON CONFLICT ("idempotencyKey") DO NOTHING
       RETURNING ${JOB_COLS}`,
      [
        randomUUID(), input.idempotencyKey, input.orgId, input.kind,
        input.payableId ?? null, input.receivableId ?? null,
        input.barcodeMasked ?? null, input.scheduleDate ?? null,
      ],
    );
    if (rows.length > 0) return rows[0] as unknown as AutomationJob;
    const existing = await this.findJob(input.orgId, input.idempotencyKey);
    if (!existing) throw new BadRequestException('job de automação não pôde ser registrado; tente novamente');
    return existing;
  }

  /**
   * Posse atômica de UMA tentativa (CAS): só sai de QUEUED/FAILED p/ RUNNING.
   * Retorna a linha possuída ou null (outro executor venceu → duplicate).
   * Fecha a race de duplo clique / workers concorrentes antes do provider.
   */
  private async claimForAttempt(jobId: string, orgId: string): Promise<AutomationJob | null> {
    const { rows } = await this.pool.query(
      `UPDATE finance_automation_jobs
       SET status = 'RUNNING', "lastError" = NULL, attempts = attempts + 1, "updatedAt" = now()
       WHERE id = $1 AND "orgId" = $2 AND status IN ('QUEUED','FAILED')
       RETURNING ${JOB_COLS}`,
      [jobId, orgId],
    );
    return (rows[0] as unknown as AutomationJob) ?? null;
  }

  /**
   * Enfileira follow-up no BullMQ (`jobId` = chave — dedupe; replay
   * concorrente cai no CAS). Fire-and-forget: nunca quebra o request
   * (o inline já persistiu FAILED + notificação; sem Redis o worker só
   * não existe e a reconciliação/tela cobre).
   */
  private async enqueueFollowUp(
    queue: 'finance.bill-pay' | 'finance.auto-charge',
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.queue) return;
    try {
      const key = String(data.idempotencyKey);
      const opts =
        queue === 'finance.bill-pay' ? billPayJobOptions(key) : autoChargeJobOptions(key);
      await this.queue.add(queue, queue, data, opts);
    } catch (e) {
      this.logger.warn(
        JSON.stringify({ event: 'finance.automation.enqueue_failed', queue, message: e instanceof Error ? e.message : String(e) }),
      );
    }
  }

  private async setJob(    id: string,
    orgId: string,
    status: AutomationJobStatus,
    lastError: string | null,
    externalId?: string,
  ): Promise<AutomationJob> {
    const { rows } = await this.pool.query(
      `UPDATE finance_automation_jobs
       SET status = $3, "lastError" = $4, attempts = attempts + 1,
           "externalId" = COALESCE($5, "externalId"), "updatedAt" = now()
       WHERE id = $1 AND "orgId" = $2
       RETURNING ${JOB_COLS}`,
      [id, orgId, status, lastError, externalId ?? null],
    );
    return rows[0] as unknown as AutomationJob;
  }
}
