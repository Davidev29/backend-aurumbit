/**
 * Projeções financeiras — núcleo puro de cálculo (Fase 5).
 *
 * Sem I/O, sem Nest, sem acesso a banco: recebe premissas + insumos em
 * memória e devolve o snapshot. Consumido por `projections.service.ts`
 * (API) e coberto por `projections.spec.ts` com fixtures.
 *
 * Premissas (`premisesHash = sha256` estável):
 * - inadimplência por método (`defaultRate`: PIX | BOLETO | CREDIT_CARD)
 * - churn mensal (decaimento das parcelas futuras de assinatura)
 * - conversão (fração esperada do PREVISTO que se efetiva)
 * - settlement: lag em dias por método até o caixa
 *   (PIX D+0, cartão D+1, boleto D+1/D+2 → usa D+2).
 *
 * Regras de agregação:
 * - previsto = Receivable PREVISTO (× conversão) + Payable PREVISTO
 *   (integral, obrigação) + parcelas futuras de Subscription ACTIVE
 *   (× conversão, decaídas por churn), bucketizadas pela data de caixa
 *   (dueDate + lag do método);
 * - pendente = PENDENTE × (1 − inadimplência[method]), bucket por dueDate
 *   (sem caixa realizado ainda);
 * - realizado = Σ Transaction (CREDIT + / DEBIT −) por occurredAt;
 * - líquido (por mês, conta e categoria) = previstoNet + pendenteNet +
 *   realizadoNet.
 * - Assinaturas futuras expandidas em memória, limite de 12 parcelas
 *   (horizonte 12m a partir de nextDueDate), via nextDueDate+billingCycle.
 *
 * Timezone: só `America/Sao_Paulo` no v1. Sem horário de verão desde
 * 2019, offset fixo UTC−3 — sem dependência de lib de TZ.
 */

import { createHash } from 'node:crypto';

export const PROJECTION_SCOPES = ['monthly', 'quarterly', 'annual'] as const;
export type ProjectionScope = (typeof PROJECTION_SCOPES)[number];

export const SUPPORTED_TZ = 'America/Sao_Paulo';

/** Offset fixo de America/Sao_Paulo (UTC−3, sem DST desde 2019). */
const SP_OFFSET_MS = -3 * 3_600_000;

const DAY_MS = 86_400_000;

export type PaymentMethod = 'PIX' | 'BOLETO' | 'CREDIT_CARD';

export interface Premises {
  /** Inadimplência esperada por método (fração 0..1). */
  defaultRate: Record<PaymentMethod, number>;
  /** Churn mensal p/ decaimento das parcelas futuras (fração 0..1). */
  churnMonthly: number;
  /** Fração do PREVISTO que se espera efetivar (0..1). */
  conversionRate: number;
  /** Lag em dias corridos até o caixa, por método. */
  settlementLagDays: Record<PaymentMethod, number>;
}

export const DEFAULT_PREMISES: Premises = {
  defaultRate: { PIX: 0.02, BOLETO: 0.08, CREDIT_CARD: 0.05 },
  churnMonthly: 0.03,
  conversionRate: 0.6,
  settlementLagDays: { PIX: 0, CREDIT_CARD: 1, BOLETO: 2 },
};

/** Limite de expansão de parcelas futuras em memória (12 meses). */
export const MAX_FUTURE_INSTALLMENTS = 12;

/** Status de títulos reconhecidos pelo cálculo (outros são ignorados). */
export const FORECAST_STATUS = 'PREVISTO';
export const PENDING_STATUS = 'PENDENTE';

// -- Insumos ---------------------------------------------------------------

export interface ReceivableInput {
  id: string;
  amountCents: number;
  status: string;
  method: PaymentMethod;
  /** Vencimento esperado (ISO). */
  dueDate: string;
  accountId?: string;
  category?: string;
}

export interface PayableInput {
  id: string;
  amountCents: number;
  status: string;
  method?: PaymentMethod;
  /** Vencimento esperado (ISO). */
  dueDate: string;
  accountId?: string;
  category?: string;
}

export type BillingCycle = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface SubscriptionInput {
  id: string;
  status: string;
  amountCents: number;
  /** Próximo vencimento (ISO). Base da expansão. */
  nextDueDate: string;
  billingCycle: BillingCycle;
  method?: PaymentMethod;
  accountId?: string;
  category?: string;
}

export interface TransactionInput {
  id: string;
  amountCents: number;
  kind: 'CREDIT' | 'DEBIT';
  accountId?: string;
  category?: string;
  /** Data de ocorrência (ISO). */
  occurredAt: string;
}

export interface ProjectionInputs {
  receivables: ReceivableInput[];
  payables: PayableInput[];
  subscriptions: SubscriptionInput[];
  transactions: TransactionInput[];
}

// -- Saída -----------------------------------------------------------------

export interface BucketTotals {
  previstoReceita: number;
  previstoDespesa: number;
  previstoNet: number;
  pendenteReceita: number;
  pendenteDespesa: number;
  pendenteNet: number;
  realizadoCredito: number;
  realizadoDebito: number;
  realizadoNet: number;
  /** previstoNet + pendenteNet + realizadoNet. */
  liquido: number;
}

export interface MonthBucket extends BucketTotals {
  month: string; // YYYY-MM (parede America/Sao_Paulo)
  start: string; // ISO UTC
  end: string; // ISO UTC
}

export interface ProjectionSnapshot {
  scope: ProjectionScope;
  refDate: string; // YYYY-MM-DD
  tz: typeof SUPPORTED_TZ;
  premisesHash: string;
  premises: Premises;
  period: { start: string; end: string };
  totals: BucketTotals;
  byMonth: MonthBucket[];
  byAccount: Record<string, BucketTotals>;
  byCategory: Record<string, BucketTotals>;
  inputCounts: {
    receivables: number;
    payables: number;
    subscriptions: number;
    transactions: number;
    installments: number;
  };
  computedAt: string;
}

// -- Validação / período ----------------------------------------------------

export function assertValidScope(scope: string): asserts scope is ProjectionScope {
  if (!(PROJECTION_SCOPES as readonly string[]).includes(scope)) {
    throw new Error(`scope inválido: ${scope} (use monthly|quarterly|annual)`);
  }
}

export function assertValidRef(ref: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) {
    throw new Error(`ref inválida: ${ref} (use YYYY-MM-DD)`);
  }
  const d = new Date(`${ref}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`ref inválida: ${ref}`);
  const [y, m, day] = ref.split('-').map(Number);
  if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) {
    throw new Error(`ref inválida (data inexistente): ${ref}`);
  }
}

export function assertValidTz(tz: string): asserts tz is typeof SUPPORTED_TZ {
  if (tz !== SUPPORTED_TZ) {
    throw new Error(`tz não suportada no v1: ${tz} (use ${SUPPORTED_TZ})`);
  }
}

/** 00:00 de (y, m0) em SP → instante UTC. */
function spMonthStartUtc(y: number, m0: number): Date {
  return new Date(Date.UTC(y, m0, 1, 0, 0, 0, 0) - SP_OFFSET_MS);
}

function addMonthsUtc(d: Date, n: number): Date {
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + n,
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

/** Chave YYYY-MM da parede America/Sao_Paulo p/ um instante UTC. */
export function spMonthKey(t: Date): string {
  const wall = new Date(t.getTime() + SP_OFFSET_MS);
  const mm = String(wall.getUTCMonth() + 1).padStart(2, '0');
  return `${wall.getUTCFullYear()}-${mm}`;
}

export interface ProjectionPeriod {
  start: Date;
  end: Date;
}

export function periodFor(scope: ProjectionScope, refDate: string, tz: string): ProjectionPeriod {
  assertValidScope(scope);
  assertValidRef(refDate);
  assertValidTz(tz);
  // ref como data de parede SP (meio-dia UTC evita borda de dia).
  const refUtc = new Date(`${refDate}T12:00:00Z`);
  const wall = new Date(refUtc.getTime() + SP_OFFSET_MS);
  const y = wall.getUTCFullYear();
  const m = wall.getUTCMonth();
  if (scope === 'monthly') {
    return { start: spMonthStartUtc(y, m), end: spMonthStartUtc(y, m + 1) };
  }
  if (scope === 'quarterly') {
    const q0 = Math.floor(m / 3) * 3;
    return { start: spMonthStartUtc(y, q0), end: spMonthStartUtc(y, q0 + 3) };
  }
  return { start: spMonthStartUtc(y, 0), end: spMonthStartUtc(y + 1, 0) };
}

export function monthsFor(scope: ProjectionScope, refDate: string, tz: string): ProjectionPeriod[] {
  const { start } = periodFor(scope, refDate, tz);
  const n = scope === 'monthly' ? 1 : scope === 'quarterly' ? 3 : 12;
  return Array.from({ length: n }, (_, i) => ({
    start: addMonthsUtc(start, i),
    end: addMonthsUtc(start, i + 1),
  }));
}

// -- Premissas ---------------------------------------------------------------

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** sha256 das premissas (chave do ProjectionSnapshot + jobId do worker). */
export function hashPremises(p: Premises): string {
  return createHash('sha256').update(stableStringify(p)).digest('hex');
}

export function assertValidPremises(p: Premises): void {
  const frac = (n: unknown): boolean => typeof n === 'number' && n >= 0 && n <= 1;
  for (const m of ['PIX', 'BOLETO', 'CREDIT_CARD'] as const) {
    if (!frac(p.defaultRate?.[m])) throw new Error(`premissa inválida: defaultRate.${m}`);
    const lag = p.settlementLagDays?.[m];
    if (!Number.isInteger(lag) || (lag as number) < 0 || (lag as number) > 30) {
      throw new Error(`premissa inválida: settlementLagDays.${m}`);
    }
  }
  if (!frac(p.churnMonthly)) throw new Error('premissa inválida: churnMonthly');
  if (!frac(p.conversionRate)) throw new Error('premissa inválida: conversionRate');
}

// -- Expansão de assinaturas --------------------------------------------------

export interface FutureInstallment {
  subscriptionId: string;
  dueDate: Date;
  /** Valor já ponderado (conversão + decaimento de churn), em centavos. */
  amountCents: number;
  method: PaymentMethod;
  accountId: string;
  category: string;
}

const CYCLE_MONTHS: Record<BillingCycle, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/**
 * Expande parcelas futuras de UMA assinatura ACTIVE em memória.
 * Para no fim do período, no horizonte de 12m após nextDueDate ou em
 * 12 parcelas (o que ocorrer primeiro).
 */
export function expandSubscriptionInstallments(
  sub: SubscriptionInput,
  periodStart: Date,
  periodEnd: Date,
  premises: Premises,
  cap = MAX_FUTURE_INSTALLMENTS,
): FutureInstallment[] {
  if (sub.status !== 'ACTIVE') return [];
  const first = new Date(sub.nextDueDate);
  if (Number.isNaN(first.getTime())) return [];
  const step = CYCLE_MONTHS[sub.billingCycle] ?? 1;
  const horizon = addMonthsUtc(first, 12);
  const method: PaymentMethod = sub.method ?? 'CREDIT_CARD';
  const out: FutureInstallment[] = [];
  let cursor = first;
  let guard = 0;
  while (cursor < periodEnd && cursor < horizon && out.length < cap && guard < cap + 24) {
    guard += 1;
    if (cursor >= periodStart) {
      const ahead = Math.max(0, monthsBetween(first, cursor));
      const decay = Math.pow(1 - premises.churnMonthly, ahead);
      out.push({
        subscriptionId: sub.id,
        dueDate: new Date(cursor),
        amountCents: Math.round(sub.amountCents * premises.conversionRate * decay),
        method,
        accountId: sub.accountId ?? 'default',
        category: sub.category ?? 'subscription',
      });
    }
    cursor = addMonthsUtc(cursor, step);
  }
  return out;
}

// -- Agregação ----------------------------------------------------------------

function emptyTotals(): BucketTotals {
  return {
    previstoReceita: 0,
    previstoDespesa: 0,
    previstoNet: 0,
    pendenteReceita: 0,
    pendenteDespesa: 0,
    pendenteNet: 0,
    realizadoCredito: 0,
    realizadoDebito: 0,
    realizadoNet: 0,
    liquido: 0,
  };
}

function finalize(t: BucketTotals): BucketTotals {
  t.previstoNet = t.previstoReceita - t.previstoDespesa;
  t.pendenteNet = t.pendenteReceita - t.pendenteDespesa;
  t.realizadoNet = t.realizadoCredito - t.realizadoDebito;
  t.liquido = t.previstoNet + t.pendenteNet + t.realizadoNet;
  return t;
}

function isMethod(m: unknown): m is PaymentMethod {
  return m === 'PIX' || m === 'BOLETO' || m === 'CREDIT_CARD';
}

export function computeProjection(args: {
  scope: ProjectionScope;
  refDate: string;
  tz: string;
  premises?: Premises;
  inputs: ProjectionInputs;
  computedAt?: string;
}): ProjectionSnapshot {
  const { scope, refDate, tz } = args;
  const premises = args.premises ?? DEFAULT_PREMISES;
  assertValidScope(scope);
  assertValidRef(refDate);
  assertValidTz(tz);
  assertValidPremises(premises);

  const { start, end } = periodFor(scope, refDate, tz);
  const buckets: MonthBucket[] = monthsFor(scope, refDate, tz).map((p) => ({
    ...emptyTotals(),
    month: spMonthKey(p.start),
    start: p.start.toISOString(),
    end: p.end.toISOString(),
  }));
  const byIndex = (t: Date): number =>
    buckets.findIndex((b) => t >= new Date(b.start) && t < new Date(b.end));

  const byAccount = new Map<string, BucketTotals>();
  const byCategory = new Map<string, BucketTotals>();
  const acc = (m: Map<string, BucketTotals>, k: string): BucketTotals => {
    let t = m.get(k);
    if (!t) {
      t = emptyTotals();
      m.set(k, t);
    }
    return t;
  };

  let installments = 0;

  // Previsto: títulos + parcelas futuras (bucket pela data de caixa).
  for (const r of args.inputs.receivables) {
    if (r.status !== FORECAST_STATUS || !isMethod(r.method)) continue;
    const due = new Date(r.dueDate);
    if (Number.isNaN(due.getTime())) continue;
    const cash = new Date(due.getTime() + premises.settlementLagDays[r.method] * DAY_MS);
    const i = byIndex(cash);
    if (i < 0) continue;
    const v = Math.round(r.amountCents * premises.conversionRate);
    const aId = r.accountId ?? 'default';
    const cId = r.category ?? 'receivable';
    buckets[i].previstoReceita += v;
    acc(byAccount, aId).previstoReceita += v;
    acc(byCategory, cId).previstoReceita += v;
  }
  for (const p of args.inputs.payables) {
    if (p.status !== FORECAST_STATUS) continue;
    const due = new Date(p.dueDate);
    if (Number.isNaN(due.getTime())) continue;
    const method = isMethod(p.method) ? p.method : 'PIX';
    const cash = new Date(due.getTime() + premises.settlementLagDays[method] * DAY_MS);
    const i = byIndex(cash);
    if (i < 0) continue;
    const aId = p.accountId ?? 'default';
    const cId = p.category ?? 'payable';
    buckets[i].previstoDespesa += p.amountCents;
    acc(byAccount, aId).previstoDespesa += p.amountCents;
    acc(byCategory, cId).previstoDespesa += p.amountCents;
  }
  for (const s of args.inputs.subscriptions) {
    for (const inst of expandSubscriptionInstallments(s, start, end, premises)) {
      installments += 1;
      const i = byIndex(inst.dueDate);
      if (i < 0) continue;
      buckets[i].previstoReceita += inst.amountCents;
      acc(byAccount, inst.accountId).previstoReceita += inst.amountCents;
      acc(byCategory, inst.category).previstoReceita += inst.amountCents;
    }
  }

  // Pendente: PENDENTE × (1 − inadimplência), bucket por vencimento.
  for (const r of args.inputs.receivables) {
    if (r.status !== PENDING_STATUS || !isMethod(r.method)) continue;
    const due = new Date(r.dueDate);
    if (Number.isNaN(due.getTime()) || due < start || due >= end) continue;
    const v = Math.round(r.amountCents * (1 - premises.defaultRate[r.method]));
    const i = byIndex(due);
    if (i < 0) continue;
    const aId = r.accountId ?? 'default';
    const cId = r.category ?? 'receivable';
    buckets[i].pendenteReceita += v;
    acc(byAccount, aId).pendenteReceita += v;
    acc(byCategory, cId).pendenteReceita += v;
  }
  for (const p of args.inputs.payables) {
    if (p.status !== PENDING_STATUS) continue;
    const due = new Date(p.dueDate);
    if (Number.isNaN(due.getTime()) || due < start || due >= end) continue;
    const method = isMethod(p.method) ? p.method : 'PIX';
    const v = Math.round(p.amountCents * (1 - premises.defaultRate[method]));
    const i = byIndex(due);
    if (i < 0) continue;
    const aId = p.accountId ?? 'default';
    const cId = p.category ?? 'payable';
    buckets[i].pendenteDespesa += v;
    acc(byAccount, aId).pendenteDespesa += v;
    acc(byCategory, cId).pendenteDespesa += v;
  }

  // Realizado: Σ Transaction por occurredAt.
  for (const t of args.inputs.transactions) {
    const at = new Date(t.occurredAt);
    if (Number.isNaN(at.getTime()) || at < start || at >= end) continue;
    const i = byIndex(at);
    if (i < 0) continue;
    const aId = t.accountId ?? 'default';
    const cId = t.category ?? 'transaction';
    if (t.kind === 'CREDIT') {
      buckets[i].realizadoCredito += t.amountCents;
      acc(byAccount, aId).realizadoCredito += t.amountCents;
      acc(byCategory, cId).realizadoCredito += t.amountCents;
    } else {
      buckets[i].realizadoDebito += t.amountCents;
      acc(byAccount, aId).realizadoDebito += t.amountCents;
      acc(byCategory, cId).realizadoDebito += t.amountCents;
    }
  }

  const totals = emptyTotals();
  for (const b of buckets) {
    finalize(b);
    totals.previstoReceita += b.previstoReceita;
    totals.previstoDespesa += b.previstoDespesa;
    totals.pendenteReceita += b.pendenteReceita;
    totals.pendenteDespesa += b.pendenteDespesa;
    totals.realizadoCredito += b.realizadoCredito;
    totals.realizadoDebito += b.realizadoDebito;
  }
  finalize(totals);
  for (const t of byAccount.values()) finalize(t);
  for (const t of byCategory.values()) finalize(t);

  return {
    scope,
    refDate,
    tz: SUPPORTED_TZ,
    premisesHash: hashPremises(premises),
    premises,
    period: { start: start.toISOString(), end: end.toISOString() },
    totals,
    byMonth: buckets,
    byAccount: Object.fromEntries(byAccount),
    byCategory: Object.fromEntries(byCategory),
    inputCounts: {
      receivables: args.inputs.receivables.length,
      payables: args.inputs.payables.length,
      subscriptions: args.inputs.subscriptions.length,
      transactions: args.inputs.transactions.length,
      installments,
    },
    computedAt: args.computedAt ?? new Date().toISOString(),
  };
}
