import type { BillingInterval, PlanView } from "@/types";

/**
 * Matriz comercial WEB × DESKTOP (Fase 8) — RÉPLICA DE UX.
 * O servidor autoriza (check-access + offline-JWT); aqui só exibimos e
 * orientamos. Nunca esconder preço nem inventar direito: tudo deriva do
 * plano vindo da API (`billingInterval` + `features[].channel`).
 */

export type Channel = "WEB" | "DESKTOP";
export type CommercialKind = "SUBSCRIPTION" | "LIFETIME";

/** ONE_TIME (desktop perpétuo) → LIFETIME; MONTH/YEAR (SaaS web) → SUBSCRIPTION. */
export function commercialKindOf(interval: BillingInterval): CommercialKind {
  return interval === "ONE_TIME" ? "LIFETIME" : "SUBSCRIPTION";
}

/** Canais cobertos pelo plano (união dos channels das features; vazio = BOTH). */
export function planChannels(plan: Pick<PlanView, "features">): Array<Channel | "BOTH"> {
  const feats = plan.features ?? [];
  if (feats.length === 0) return ["BOTH"];
  const set = new Set(feats.map((f) => f.channel ?? "BOTH"));
  return [...set];
}

/** O plano serve este canal? (BOTH atende tudo.) */
export function planServesChannel(
  plan: Pick<PlanView, "features">,
  channel: Channel
): boolean {
  const chs = planChannels(plan);
  return chs.includes("BOTH") || (chs as string[]).includes(channel);
}

export function commercialKindLabel(kind: CommercialKind): string {
  return kind === "LIFETIME" ? "Compra única · sua para sempre" : "Assinatura · renova por período";
}

export function intervalLabel(interval: BillingInterval): string {
  if (interval === "MONTH") return "Mensal";
  if (interval === "YEAR") return "Anual";
  return "Único";
}
