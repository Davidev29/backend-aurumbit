/**
 * Bill Payments (contas a pagar via Conta Asaas) — tipos + decisões puras.
 * Espelha a API Asaas v3 `Bill Payments`:
 * - Paga boletos/concessionárias da conta digital Asaas via linha digitável
 *   (`identificationField`), com execução agendada (`scheduleDate`).
 * - Regras Asaas (ver docs `Create a bill payment` + `Bill events`):
 *   - boleto vencido NÃO agenda — paga na hora da criação;
 *   - `scheduleDate` em dia não útil → próximo dia útil (lado Asaas);
 *   - pedido após 14h p/ o próprio dia → próximo dia útil (lado Asaas);
 *   - sandbox: usar linha de boleto gerado na própria conta sandbox.
 */

export interface BillPaymentInput {
  /** Linha digitável (47/48 dígitos, com ou sem máscara). */
  identificationField: string;
  /** Agendamento ISO (YYYY-MM-DD). Ausente = na data do vencimento do boleto. */
  scheduleDate?: string;
  description?: string;
  /** Referência opaca interna (ex. payableId) — idempotência natural. */
  externalReference?: string;
}

export interface BillPayment {
  id: string;
  status: string;
  valueCents?: number;
  dueDate?: string | null;
  scheduleDate?: string | null;
}

export type BillKind = 'BOLETO' | 'CONVENIO';

/**
 * Capacidade Asaas p/ pagar a conta (pura/testável).
 * - 47 dígitos = boleto bancário (linha digitável);
 * - 48 dígitos = convênio/concessionária/fatura;
 * - demais tamanhos → fora do Bill Payments (só manual).
 */
export function billKindFor(digits: string): BillKind | null {
  const d = digits.replace(/\D/g, '');
  if (d.length === 47) return 'BOLETO';
  if (d.length === 48) return 'CONVENIO';
  return null;
}

export function canPayViaAsaas(digits: string): { ok: boolean; kind: BillKind | null; reason: string } {
  const kind = billKindFor(digits);
  if (kind) return { ok: true, kind, reason: 'suportado pelo Bill Payments Asaas' };
  return { ok: false, kind: null, reason: 'fora do Bill Payments Asaas (só boleto 47 / convênio 48 dígitos)' };
}

function todayISO(tzOffsetMs = 0, nowMs = Date.now()): string {
  return new Date(nowMs + tzOffsetMs).toISOString().slice(0, 10);
}

/**
 * Decide execução imediata vs agendada (pura/testável).
 * - vencido (`dueDate < hoje`) → imediato (`scheduleDate = hoje`, Asaas paga na hora);
 * - futuro → agenda em `scheduleDate ?? dueDate ?? hoje`.
 */
export function resolveBillSchedule(input: {
  dueDate?: string | null;
  scheduleDate?: string | null;
  nowMs?: number;
}): { immediate: boolean; scheduleDate: string } {
  const today = todayISO(0, input.nowMs ?? Date.now());
  const due = (input.dueDate ?? '').slice(0, 10);
  const wanted = (input.scheduleDate ?? due ?? today).slice(0, 10) || today;
  if (due && due < today) return { immediate: true, scheduleDate: today };
  if (wanted <= today) return { immediate: true, scheduleDate: today };
  return { immediate: false, scheduleDate: wanted };
}

/** `jobId` BullMQ p/ bill-pay: sempre a chave de idempotência (PROJECT.md §5). */
export function jobIdForBillPay(idempotencyKey: string): string {
  return `finance:bill-pay:${idempotencyKey}`;
}

/** `jobId` BullMQ p/ cobrança automática de recebível. */
export function jobIdForAutoCharge(idempotencyKey: string): string {
  return `finance:auto-charge:${idempotencyKey}`;
}
