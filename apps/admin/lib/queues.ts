import { apiGet, apiPost } from "./api/client";

export interface DlqQueueDepth {
  queue: string;
  depth: number;
  oldestEnqueuedAt: string | null;
  lastError: string | null;
}

export interface DlqOverview {
  queues: DlqQueueDepth[];
  /** `true` ⇔ profundidades são snapshot (podem estar desatualizadas). */
  isStale: boolean;
  staleReason?: string;
  asOf: string;
}

export interface ReplayDlqRequest {
  motivo: string;
  confirmacao: boolean;
}

/**
 * Filas/DLQ via BFF (`/api/queues/*` → Nest `/v1/queues/*` quando
 * `API_INTERNAL_URL` está configurado; stub em `lib/mocks.ts` senão).
 *
 * - Leitura exige `billing.read`; replay exige `billing.manage` (só admin) +
 *   motivo >= 10 + confirmação na UI. POST carrega `Idempotency-Key`.
 * - TODO(backend real Fase 6): o Nest expõe `GET /v1/queues/dlq` (depth por
 *   fila) e `POST /v1/queues/dlq/replay` (re-enfileira + audit `queue.replay`);
 *   hoje o BFF responde stub auditado localmente.
 */
function idempotencyHeaders(): Record<string, string> {
  const key =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { "Idempotency-Key": key };
}

export function getDlqOverview(): Promise<DlqOverview> {
  return apiGet<DlqOverview>("/api/queues/dlq");
}

export function replayDlq(
  queue: string,
  req: ReplayDlqRequest,
): Promise<{ queue: string; replayed: number; auditId: string }> {
  return apiPost(
    `/api/queues/dlq/${encodeURIComponent(queue)}/replay`,
    req,
    { headers: idempotencyHeaders() },
  );
}
