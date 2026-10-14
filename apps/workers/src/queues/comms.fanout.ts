// Fan-out PaymentConfirmed (Fase 4, PROJECT.md §§5-6).
// `billing.payment.confirmed.v1` → access / licensing / finance / notifications.
// Cada alvo é injetável (stub por padrão); o efeito real vive nos domínios ou
// no Resend — o worker só roteia com `idempotencyKey = eventId` e registra.
// Falha em um alvo não bloqueia os demais (resultado por alvo; retry cobre o
// job inteiro e os alvos idempotentes descartam o replay).
// Métrica: `billing.fanout.delivered` (por alvo ok) / `billing.fanout.dlq`.

import { billingMetricInc } from './billing.metrics';

export const PAYMENT_CONFIRMED_TOPIC = 'billing.payment.confirmed.v1';

export type FanoutTarget = 'access' | 'licensing' | 'finance' | 'notifications';

export const FANOUT_TARGETS: readonly FanoutTarget[] = [
  'access',
  'licensing',
  'finance',
  'notifications',
];

export interface FanoutEnvelope {
  eventId: string;
  topic: string;
  payload: unknown;
}

export interface FanoutDeps {
  /** access: espelhar entitlement/contrato (TODO: POST interno idempotente). */
  toAccess?: (env: FanoutEnvelope) => Promise<void>;
  /** licensing: issue/renew da licença — vigência inicia na confirmação (TODO). */
  toLicensing?: (env: FanoutEnvelope) => Promise<void>;
  /** finance: lançar receita realizada (TODO Fase 5). */
  toFinance?: (env: FanoutEnvelope) => Promise<void>;
  /** notifications: `communications.send` template `payment-confirmed` v1 (TODO Resend). */
  toNotifications?: (env: FanoutEnvelope) => Promise<void>;
}

export type FanoutResult = Record<FanoutTarget, 'delivered' | 'skipped' | 'failed'>;

function stubTarget(target: FanoutTarget): (env: FanoutEnvelope) => Promise<void> {
  return async (env) => {
    // TODO(Fase 4+): efeito real por alvo com idempotencyKey=eventId.
    // Stub registra e confirma para não bloquear o pipeline.
    void target;
    void env;
  };
}

export async function fanOutPaymentConfirmed(
  env: FanoutEnvelope,
  deps: FanoutDeps = {},
): Promise<FanoutResult> {
  const routes: Record<FanoutTarget, (env: FanoutEnvelope) => Promise<void>> = {
    access: deps.toAccess ?? stubTarget('access'),
    licensing: deps.toLicensing ?? stubTarget('licensing'),
    finance: deps.toFinance ?? stubTarget('finance'),
    notifications: deps.toNotifications ?? stubTarget('notifications'),
  };
  const result = {} as FanoutResult;
  for (const target of FANOUT_TARGETS) {
    try {
      await routes[target](env);
      result[target] = deps[
        `to${target[0].toUpperCase()}${target.slice(1)}` as keyof FanoutDeps
      ]
        ? 'delivered'
        : 'skipped';
      if (result[target] === 'delivered') billingMetricInc('billing.fanout.delivered');
    } catch {
      result[target] = 'failed';
      billingMetricInc('billing.fanout.dlq');
    }
  }
  return result;
}

/** Roteia tópico billing.* → fila alvo (desconhecido → null = DLQ com reason). */
export function routeBillingTopic(topic: string): 'webhook' | 'fanout' | 'recon' | null {
  if (topic === 'billing.webhook.received.v1') return 'webhook';
  if (topic === PAYMENT_CONFIRMED_TOPIC) return 'fanout';
  if (topic === 'billing.reconciliation.completed.v1') return 'recon';
  return null;
}
