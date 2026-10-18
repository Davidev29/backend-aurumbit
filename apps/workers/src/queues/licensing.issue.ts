// Consumidor `licensing.issue` (Fase 8, Asaas→licença).
// - Entrada: envelope `billing.payment.confirmed.v1` (relay) com
//   `paymentId` no payload (jobId = eventId, PROJECT.md §5).
// - Passos (todos via HTTP injetável, sem `pg` no worker):
//   1. `GET /v1/billing/internal/issue-context/:paymentId` (x-internal-key)
//      → refs opacas do pedido (productId/planRef/billingInterval) + titular.
//   2. `GET /v1/products/plans/:code` (catálogo público) → features+channels
//      p/ o snapshot da licença (ausente/erro → snapshot vazio = curinga legado).
//   3. `POST /v1/licenses/internal/issue-from-payment` (x-internal-key,
//      claim-first por eventId) → `{duplicate:true}` em replay, sem 2ª licença.
// - Envelope inválido ou pagamento fora de CONFIRMED → DLQ direto (poison).
// - 5xx/rede → relança p/ retry; esgotado → DLQ preservando o eventId.

import { z } from 'zod';

export const ISSUE_MAX_ATTEMPTS = 5;

export const ISSUE_CONTEXT_ENDPOINT = '/v1/billing/internal/issue-context';
export const PLANS_ENDPOINT = '/v1/plans';
export const ISSUE_FROM_PAYMENT_ENDPOINT = '/v1/licenses/internal/issue-from-payment';

const ConfirmedEnvelopeSchema = z
  .object({
    eventId: z.string().min(8),
    topic: z.literal('billing.payment.confirmed.v1'),
    version: z.number().int().min(1).default(1),
    occurredAt: z.string().min(1),
    payload: z
      .object({
        paymentId: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export type IssueJobRef = {
  id?: string;
  data: unknown;
  attemptsMade: number;
};

export interface IssueHttpPost {
  (url: string, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface IssueHttpGet {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export interface LicensingIssueDeps {
  apiBaseUrl: string;
  internalKey: string;
  get?: IssueHttpGet;
  post?: IssueHttpPost;
  maxAttempts?: number;
  moveToDlq: (jobId: string, data: Record<string, unknown>, reason: string) => Promise<void>;
}

export type LicensingIssueOutcome =
  | { status: 'issued' | 'duplicate'; eventId: string; licenseId?: string }
  | { status: 'dlq'; eventId: string };

function dlqId(eventId: string): string {
  return `dlq:${eventId}`;
}

type Ctx = {
  payment: { id: string; externalId: string; amountCents: number; status: string; paidAt: string | null };
  invoice: {
    orderId: string | null;
    productId: string | null;
    planRef: string | null;
    billingInterval: string | null;
    promotionId: string | null;
    status: string;
  };
  ownerUserId: string;
};

export async function handleLicensingIssueJob(
  job: IssueJobRef,
  deps: LicensingIssueDeps,
): Promise<LicensingIssueOutcome> {
  const parsed = ConfirmedEnvelopeSchema.safeParse(job.data);
  if (!parsed.success) {
    const reason = `envelope inválido: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`;
    const fallbackId =
      typeof job.id === 'string' && job.id.length >= 8 ? job.id : 'job-sem-eventid';
    await deps.moveToDlq(dlqId(fallbackId), { ...(job.data as Record<string, unknown>), eventId: fallbackId }, reason);
    return { status: 'dlq', eventId: fallbackId };
  }
  const env = parsed.data;
  const max = deps.maxAttempts ?? ISSUE_MAX_ATTEMPTS;
  const headers = { 'x-internal-key': deps.internalKey };

  const get = deps.get ?? (async (url: string) => {
    const r = await fetch(url, { headers });
    return { ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> };
  });
  const post = deps.post ?? (async (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) => {
    const r = await fetch(url, init);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  });

  const run = async (): Promise<LicensingIssueOutcome> => {
    // 1. Contexto comercial do pagamento (refs opacas, sem cross-schema read).
    const ctxRes = await get(`${deps.apiBaseUrl}${ISSUE_CONTEXT_ENDPOINT}/${env.payload.paymentId}`, { headers });
    if (ctxRes.status === 404) {
      await deps.moveToDlq(dlqId(env.eventId), { ...env }, 'issue-context 404 (poison)');
      return { status: 'dlq', eventId: env.eventId };
    }
    if (!ctxRes.ok) throw new Error(`issue-context ${ctxRes.status}`);
    const ctx = (await ctxRes.json()) as Ctx;
    if (ctx.payment.status !== 'CONFIRMED' || !ctx.payment.paidAt) {
      await deps.moveToDlq(dlqId(env.eventId), { ...env }, `pagamento ${ctx.payment.status} sem paidAt (poison)`);
      return { status: 'dlq', eventId: env.eventId };
    }
    if (!ctx.invoice.productId || !ctx.invoice.billingInterval) {
      await deps.moveToDlq(dlqId(env.eventId), { ...env }, 'invoice sem refs comerciais (poison)');
      return { status: 'dlq', eventId: env.eventId };
    }

    // 2. Snapshot de features do plano (catálogo público; falha → curinga legado).
    let features: Array<{ code: string; channel: string }> = [];
    if (ctx.invoice.planRef) {
      try {
        const planRes = await get(`${deps.apiBaseUrl}${PLANS_ENDPOINT}/${encodeURIComponent(ctx.invoice.planRef)}`);
        if (planRes.ok) {
          const plan = (await planRes.json()) as { features?: Array<{ featureCode?: string; channel?: string }> };
          features = (plan.features ?? [])
            .filter((f) => typeof f.featureCode === 'string')
            .map((f) => ({ code: f.featureCode as string, channel: f.channel ?? 'BOTH' }));
        }
      } catch {
        features = [];
      }
    }

    // 3. Emissão claim-first (replay → duplicate, sem 2ª licença).
    const issueRes = await post(`${deps.apiBaseUrl}${ISSUE_FROM_PAYMENT_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': deps.internalKey },
      body: JSON.stringify({
        eventId: env.eventId,
        paymentId: ctx.payment.id,
        externalId: ctx.payment.externalId,
        orderId: ctx.invoice.orderId,
        ownerType: 'CUSTOMER',
        ownerId: ctx.ownerUserId,
        productId: ctx.invoice.productId,
        planId: ctx.invoice.planRef,
        promotionId: ctx.invoice.promotionId ?? undefined,
        billingInterval: ctx.invoice.billingInterval,
        paidAt: ctx.payment.paidAt,
        amountCents: ctx.payment.amountCents,
        features,
      }),
    });
    if (issueRes.status === 404 || issueRes.status === 422) {
      const text = await issueRes.text().catch(() => '');
      await deps.moveToDlq(dlqId(env.eventId), { ...env }, `issue ${issueRes.status} (poison): ${text.slice(0, 200)}`);
      return { status: 'dlq', eventId: env.eventId };
    }
    if (!issueRes.ok) throw new Error(`issue ${issueRes.status}`);
    const out = JSON.parse(await issueRes.text().catch(() => '{}')) as { duplicate?: boolean; license?: { id?: string } };
    return out.duplicate === true
      ? { status: 'duplicate', eventId: env.eventId }
      : { status: 'issued', eventId: env.eventId, licenseId: out.license?.id };
  };

  try {
    return await run();
  } catch (err) {
    if (job.attemptsMade + 1 >= max) {
      await deps.moveToDlq(dlqId(env.eventId), { ...env }, err instanceof Error ? err.message : String(err));
      return { status: 'dlq', eventId: env.eventId };
    }
    throw err;
  }
}
