// Consumidor `finance.sync` (sync billing→finance, Fase 5).
// - `jobId = eventId` na produção (ver finance.queues financeSyncJobOptions).
// - Envelope inválido → DLQ direto (poison; retry não ajuda).
// - Aplica via `POST /v1/finance/internal/sync` com o envelope completo
//   (API executa idempotente por eventId: ProcessedEvent + ON CONFLICT).
// - Resposta 2xx com `duplicate/noop` → completa sem retry (decisão de
//   negócio, não falha transitória). 404 → DLQ direto. 5xx/rede →
//   relança p/ retry exponencial; esgotados os attempts → `finance.dlq`
//   preservando o eventId original.
// - O worker nunca escreve PG direto (sem dep `pg`); HTTP injetável
//   p/ teste sem rede (mesmo padrão de `billing.apply`).

import { FinanceSyncJobSchema, financeDlqJobId } from './finance.queues';

export const FINANCE_SYNC_MAX_ATTEMPTS = 5;

export const FINANCE_SYNC_ENDPOINT = '/v1/finance/internal/sync';

export interface FinanceJobRef {
  id?: string;
  data: unknown;
  attemptsMade: number;
}

export interface FinanceHttpPostResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FinanceHttpPost = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<FinanceHttpPostResponse>;

export function defaultFinanceHttpPost(): FinanceHttpPost {
  const g = globalThis as unknown as { fetch?: FinanceHttpPost };
  if (typeof g.fetch !== 'function') throw new Error('fetch indisponível (Node >= 20)');
  return (url, init) => g.fetch!(url, init);
}

export interface FinanceSyncDeps {
  apiBaseUrl: string;
  internalKey: string;
  post?: FinanceHttpPost;
  maxAttempts?: number;
  moveToDlq: (jobId: string, data: Record<string, unknown>, reason: string) => Promise<void>;
}

export type FinanceSyncOutcome =
  | { status: 'applied' | 'noop' | 'duplicate'; eventId: string }
  | { status: 'dlq'; eventId: string };

export async function handleFinanceSyncJob(
  job: FinanceJobRef,
  deps: FinanceSyncDeps,
): Promise<FinanceSyncOutcome> {
  const parsed = FinanceSyncJobSchema.safeParse(job.data);
  if (!parsed.success) {
    const reason = `envelope inválido: ${parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')}`;
    const fallbackId =
      typeof job.id === 'string' && job.id.length >= 8 ? job.id : 'job-sem-eventid';
    await deps.moveToDlq(
      financeDlqJobId(fallbackId),
      { ...(job.data as Record<string, unknown>), eventId: fallbackId },
      reason,
    );
    return { status: 'dlq', eventId: fallbackId };
  }
  const data = parsed.data;
  const max = deps.maxAttempts ?? FINANCE_SYNC_MAX_ATTEMPTS;
  const post = deps.post ?? defaultFinanceHttpPost();

  let res: FinanceHttpPostResponse;
  try {
    res = await post(`${deps.apiBaseUrl}${FINANCE_SYNC_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': deps.internalKey },
      body: JSON.stringify(data),
    });
  } catch (err) {
    // Rede → retry; esgotado → DLQ.
    if (job.attemptsMade + 1 >= max) {
      await deps.moveToDlq(
        financeDlqJobId(data.eventId),
        { ...data },
        err instanceof Error ? err.message : String(err),
      );
      return { status: 'dlq', eventId: data.eventId };
    }
    throw err;
  }

  if (res.status === 404) {
    const text = await res.text().catch(() => '');
    await deps.moveToDlq(
      financeDlqJobId(data.eventId),
      { ...data },
      `sync 404 (poison): ${text.slice(0, 200)}`,
    );
    return { status: 'dlq', eventId: data.eventId };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`sync ${res.status}: ${text.slice(0, 200)}`);
    if (job.attemptsMade + 1 >= max) {
      await deps.moveToDlq(financeDlqJobId(data.eventId), { ...data }, err.message);
      return { status: 'dlq', eventId: data.eventId };
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
  if (out.status === 'duplicate' || out.duplicate === true) {
    return { status: 'duplicate', eventId: data.eventId };
  }
  if (out.status === 'applied') return { status: 'applied', eventId: data.eventId };
  return { status: 'noop', eventId: data.eventId };
}
