// Tick billing.recon (Fase 4, PROJECT.md §5).
// - Hourly: pendentes <7d; daily 03:00 America/Sao_Paulo: janela 30d.
// - Pagina o Asaas (injetável; Sandbox-first), compara `externalId → status`,
//   emite o sintético `recon:<id>:<data>` pelo mesmo pipeline (`jobId` igual).
// - Divergência valor/estado → `alert` + e-mail admin (injetáveis) + métricas
//   `billing.recon.*`. Handler puro: sem Redis/PG direto.

import { billingMetricInc } from './billing.metrics';

/** eventId sintético da reconciliação (mesmo pipeline, PROJECT.md §5). */
export function reconEventId(paymentId: string, day: string): string {
  return `recon:${paymentId}:${day}`;
}

export interface ReconPending {
  paymentId: string;
  externalId: string;
  localStatus: string;
  amountCents: number;
}

export interface ReconDeps {
  now?: Date;
  /** Pendentes na janela (hourly <7d, daily 30d — o chamador filtra). */
  listPending: () => Promise<ReconPending[]>;
  /** Status remoto no Asaas Sandbox (null = ausente → divergência). */
  fetchRemote: (externalId: string) => Promise<{ status: string; valueCents: number } | null>;
  /** Emite o sintético pelo pipeline (outbox + fila, jobId = eventId). */
  emitSynthetic: (eventId: string, payload: Record<string, unknown>) => Promise<void>;
  alert: (detail: string) => Promise<void>;
  notifyAdmin: (detail: string) => Promise<void>;
}

export async function runReconTick(deps: ReconDeps): Promise<{
  checked: number;
  divergences: number;
  synthetic: string[];
}> {
  const now = deps.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const pending = await deps.listPending();
  let divergences = 0;
  const synthetic: string[] = [];
  for (const p of pending) {
    billingMetricInc('billing.recon.checked');
    const remote = await deps.fetchRemote(p.externalId);
    const eventId = reconEventId(p.paymentId, day);
    if (!remote || remote.status !== p.localStatus || remote.valueCents !== p.amountCents) {
      divergences += 1;
      billingMetricInc('billing.recon.diverged');
      const detail =
        `recon divergência ${p.externalId}: local ${p.localStatus}/${p.amountCents}` +
        ` ≠ asaas ${remote ? `${remote.status}/${remote.valueCents}` : 'ausente'}`;
      await deps.alert(detail);
      await deps.notifyAdmin(detail);
    }
    await deps.emitSynthetic(eventId, {
      externalId: p.externalId,
      local: p.localStatus,
      remote: remote?.status ?? null,
    });
    synthetic.push(eventId);
  }
  billingMetricInc('billing.recon.completed');
  return { checked: pending.length, divergences, synthetic };
}
