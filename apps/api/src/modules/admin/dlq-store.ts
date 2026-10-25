// Registro DLQ lado API (Fase 6, aditivo — sem duplicar filas).
// Os workers já têm `moveToDlq` por domínio (email-sender, billing.apply,
// finance.sync, licensing.sync) com retry 5x + DLQ `*.dlq` e `jobId=eventId`.
// O que faltava era o registro consultável + replay manual: este módulo é
// esse registro em memória (hermético p/ testes/e2e sem PG/Redis).
// Produção: espelhar no PG (`audit.dlq_entries`) ou ler depth do Redis
// BullMQ. O replay real re-enfileira na fila de origem com o mesmo `jobId`
// (dedupe BullMQ preserva o eventId) via `requeueFn` injetável; sem
// `requeueFn` o replay é lógico (idempotente) + auditado.

export const KNOWN_DLQ_QUEUES = [
  'billing.dlq',
  'finance.dlq',
  'comm.email.dlq',
  'licensing.dlq',
] as const;

export type KnownDlqQueue = (typeof KNOWN_DLQ_QUEUES)[number];

/** Mapeia fila DLQ → fila de origem para re-enfileiramento real. */
export const DLQ_TO_ORIGIN: Record<string, string> = {
  'billing.dlq': 'billing.webhook.apply',
  'finance.dlq': 'finance.sync',
  'comm.email.dlq': 'communications.send',
  'licensing.dlq': 'licensing.sync',
} as const;

export interface DlqEntryInput {
  queue: string;
  jobId: string;
  eventId: string;
  data?: unknown;
  reason?: string;
}

export interface DlqEntry {
  queue: string;
  jobId: string;
  eventId: string;
  data: unknown;
  reason: string;
  enqueuedAt: string;
  replayedAt: string | null;
  replayCount: number;
}

export interface DlqReplayResult {
  queue: string;
  jobId: string;
  eventId: string;
  /** true quando o job já havia sido replayado (idempotente, sem re-enfileirar). */
  duplicate: boolean;
  replayCount: number;
  /** true quando o re-enfileiramento real na fila de origem ocorreu. */
  requeued: boolean;
}

/** Assinatura da função de re-enfileiramento real (injetada pelo controller). */
export type DlqRequeueFn = (
  queue: string,
  jobId: string,
  data: unknown,
) => Promise<void>;

function nowIso(): string {
  return new Date().toISOString();
}

/** Normaliza nome de fila DLQ (`*.dlq`); fora do padrão vira `<nome>.dlq`. */
export function normalizeDlqQueue(queue: string): string {
  const q = String(queue ?? '').trim();
  if (q.length === 0) return 'unknown.dlq';
  return q.endsWith('.dlq') ? q : `${q}.dlq`;
}

export class InMemoryDlqStore {
  private readonly entries = new Map<string, DlqEntry>();

  private key(queue: string, jobId: string): string {
    return `${queue}::${jobId}`;
  }

  /** Enfileira na DLQ (idempotente por queue+jobId: duplicata retorna a existente). */
  enqueue(input: DlqEntryInput): { entry: DlqEntry; duplicate: boolean } {
    const queue = normalizeDlqQueue(input.queue);
    const jobId = String(input.jobId ?? '').slice(0, 256) || 'job-sem-id';
    const eventId = String(input.eventId ?? jobId).slice(0, 256);
    const k = this.key(queue, jobId);
    const existing = this.entries.get(k);
    if (existing) return { entry: { ...existing }, duplicate: true };
    const entry: DlqEntry = {
      queue,
      jobId,
      eventId,
      data: input.data ?? {},
      reason: String(input.reason ?? 'sem-motivo').slice(0, 500),
      enqueuedAt: nowIso(),
      replayedAt: null,
      replayCount: 0,
    };
    this.entries.set(k, entry);
    return { entry: { ...entry }, duplicate: false };
  }

  /** Lista paginada (filtro opcional por fila; mais antigas primeiro). */
  list(opts: { queue?: string; page?: number; pageSize?: number } = {}): {
    items: DlqEntry[];
    page: number;
    pageSize: number;
    total: number;
  } {
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 20)));
    const q = opts.queue ? normalizeDlqQueue(opts.queue) : null;
    const all = [...this.entries.values()]
      .filter((e) => (q ? e.queue === q : true))
      .sort((a, b) => (a.enqueuedAt < b.enqueuedAt ? -1 : a.enqueuedAt > b.enqueuedAt ? 1 : 0));
    const total = all.length;
    const items = all.slice((page - 1) * pageSize, page * pageSize).map((e) => ({ ...e }));
    return { items, page, pageSize, total };
  }

  /**
   * Replay idempotente: 1ª chamada marca `replayedAt` (TODO: re-enqueue real
   * na fila de origem com o mesmo `jobId`); chamadas seguintes retornam
   * `duplicate: true` sem re-enfileirar. Sem `jobId` replays até `limit`
   * pendentes da fila (lote, mesma idempotência por item).
   */
  replay(queue: string, jobId?: string, limit = 100): DlqReplayResult[] {
    const q = normalizeDlqQueue(queue);
    const targets = [...this.entries.values()]
      .filter((e) => e.queue === q && (!jobId || e.jobId === jobId || e.eventId === jobId))
      .filter((e) => e.replayedAt === null)
      .slice(0, Math.max(1, Math.min(1000, Math.floor(limit))));
    // jobId inexistente ou já replayado → duplicate (sem erro, sem duplicar).
    if (jobId && targets.length === 0) {
      const k = this.key(q, jobId);
      const existing = this.entries.get(k) ?? [...this.entries.values()].find((e) => e.queue === q && e.eventId === jobId);
      if (existing) {
        return [
          {
            queue: q,
            jobId: existing.jobId,
            eventId: existing.eventId,
            duplicate: true,
            replayCount: existing.replayCount,
            requeued: false,
          },
        ];
      }
      return [];
    }
    const out: DlqReplayResult[] = [];
    for (const t of targets) {
      const k = this.key(t.queue, t.jobId);
      const cur = this.entries.get(k);
      if (!cur) continue;
      if (cur.replayedAt !== null) {
        out.push({ queue: q, jobId: cur.jobId, eventId: cur.eventId, duplicate: true, replayCount: cur.replayCount, requeued: false });
        continue;
      }
      cur.replayedAt = nowIso();
      cur.replayCount += 1;
      out.push({ queue: q, jobId: cur.jobId, eventId: cur.eventId, duplicate: false, replayCount: cur.replayCount, requeued: false });
    }
    return out;
  }

  /** Profundidade por fila (p/ `/health/ready` warn + painel admin). */
  depth(queue?: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.entries.values()) {
      if (e.replayedAt !== null) continue; // replayados não pressionam operação
      if (queue && normalizeDlqQueue(queue) !== e.queue) continue;
      out[e.queue] = (out[e.queue] ?? 0) + 1;
    }
    return out;
  }

  totalPending(): number {
    return Object.values(this.depth()).reduce((a, b) => a + b, 0);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Singleton do processo API (compartilhado entre o controller admin e o
 * `/health/ready`). Testes unitários devem instanciar `InMemoryDlqStore`
 * próprio; o singleton existe só p/ wiring Nest (sem Redis/PG).
 */
export const dlqStore = new InMemoryDlqStore();
