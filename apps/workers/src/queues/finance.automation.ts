// Consumidores `finance.bill-pay` + `finance.auto-charge` (automação, Fase 5+).
// - `jobId = finance:bill-pay:<idempotencyKey>` / `finance:auto-charge:<idempotencyKey>`
//   na produção (dedupe BullMQ; duplo enqueue não duplica pagamento).
// - Envelope inválido → DLQ direto (poison; retry não ajuda).
// - Aplica via `POST /v1/finance/internal/automation/*` com o payload do
//   job-data (API executa idempotente: CAS QUEUED/FAILED→RUNNING + replay
//   DONE/SCHEDULED/CANCELED → duplicate).
// - Resposta 2xx com `duplicate` → completa sem retry (decisão de negócio).
//   400 → DLQ direto (poison). 404 → DLQ direto. 5xx/rede → relança p/ retry
//   exponencial; esgotados os attempts → `finance.dlq` preservando o id.
// - O worker nunca escreve PG direto (sem dep `pg`); HTTP injetável
//   p/ teste sem rede (mesmo padrão de `finance.sync`).

import { z } from 'zod';

export const FINANCE_BILL_PAY_QUEUE = 'finance.bill-pay';
export const FINANCE_AUTO_CHARGE_QUEUE = 'finance.auto-charge';
export const FINANCE_AUTOMATION_DLX = 'finance.dlq';

export const FINANCE_AUTOMATION_MAX_ATTEMPTS = 5;

export const FINANCE_BILL_PAY_ENDPOINT = '/v1/finance/internal/automation/bill-pay';
export const FINANCE_AUTO_CHARGE_ENDPOINT = '/v1/finance/internal/automation/auto-charge';

export const FinanceAutomationEnvelopeSchema = z
  .object({
    idempotencyKey: z.string().min(8),
    orgId: z.string().min(1),
  })
  .passthrough();

export type FinanceAutomationEnvelope = z.infer<typeof FinanceAutomationEnvelopeSchema>;

export interface FinanceAutomationJobRef {
  id?: string;
  data: unknown;
  attemptsMade: number;
}

export interface FinanceAutomationHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FinanceAutomationHttpPost = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<FinanceAutomationHttpResponse>;

export function defaultFinanceAutomationHttpPost(): FinanceAutomationHttpPost {
  const g = globalThis as unknown as { fetch?: FinanceAutomationHttpPost };
  if (typeof g.fetch !== 'function') throw new Error('fetch indisponível (Node >= 20)');
  return (url, init) => g.fetch!(url, init);
}

export interface FinanceAutomationDeps {
  apiBaseUrl: string;
  internalKey: string;
  endpoint: typeof FINANCE_BILL_PAY_ENDPOINT | typeof FINANCE_AUTO_CHARGE_ENDPOINT;
  post?: FinanceAutomationHttpPost;
  maxAttempts?: number;
  moveToDlq: (jobId: string, data: Record<string, unknown>, reason: string) => Promise<void>;
}

export type FinanceAutomationOutcome =
  | { status: 'applied' | 'noop' | 'duplicate'; idempotencyKey: string }
  | { status: 'dlq'; idempotencyKey: string };

function dlqId(prefix: string, id: string): string {
  return `dlq:${prefix}:${id}`;
}

export async function handleFinanceAutomationJob(
  job: FinanceAutomationJobRef,
  deps: FinanceAutomationDeps,
): Promise<FinanceAutomationOutcome> {
  const parsed = FinanceAutomationEnvelopeSchema.safeParse(job.data);
  if (!parsed.success) {
    const reason = `envelope inválido: ${parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')}`;
    const fallbackId =
      typeof job.id === 'string' && job.id.length >= 8 ? job.id : 'job-sem-chave';
    await deps.moveToDlq(dlqId('automation', fallbackId), { ...(job.data as Record<string, unknown>) }, reason);
    return { status: 'dlq', idempotencyKey: fallbackId };
  }
  const data = parsed.data as Record<string, unknown> & { idempotencyKey: string };
  const max = deps.maxAttempts ?? FINANCE_AUTOMATION_MAX_ATTEMPTS;
  const post = deps.post ?? defaultFinanceAutomationHttpPost();

  let res: FinanceAutomationHttpResponse;
  try {
    res = await post(`${deps.apiBaseUrl}${deps.endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': deps.internalKey },
      body: JSON.stringify(data),
    });
  } catch (err) {
    if (job.attemptsMade + 1 >= max) {
      await deps.moveToDlq(
        dlqId('automation', data.idempotencyKey),
        { ...data },
        err instanceof Error ? err.message : String(err),
      );
      return { status: 'dlq', idempotencyKey: data.idempotencyKey };
    }
    throw err;
  }

  // 400 = poison (validação de negócio — retry não ajuda); 404 = sem job/rota.
  if (res.status === 400 || res.status === 404) {
    const text = await res.text().catch(() => '');
    await deps.moveToDlq(
      dlqId('automation', data.idempotencyKey),
      { ...data },
      `automation ${res.status} (poison): ${text.slice(0, 200)}`,
    );
    return { status: 'dlq', idempotencyKey: data.idempotencyKey };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`automation ${res.status}: ${text.slice(0, 200)}`);
    if (job.attemptsMade + 1 >= max) {
      await deps.moveToDlq(dlqId('automation', data.idempotencyKey), { ...data }, err.message);
      return { status: 'dlq', idempotencyKey: data.idempotencyKey };
    }
    throw err;
  }

  const bodyText = await res.text().catch(() => '{}');
  let out: Record<string, unknown> = {};
  try {
    out = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    out = {};
  }
  if (out.duplicate === true) return { status: 'duplicate', idempotencyKey: data.idempotencyKey };
  if (typeof out.status === 'string' && ['DONE', 'SCHEDULED'].includes(out.status)) {
    return { status: 'applied', idempotencyKey: data.idempotencyKey };
  }
  return { status: 'noop', idempotencyKey: data.idempotencyKey };
}
