// Regra de decisão do check-access (pura, sem I/O — coberta por unit test).
// Semântica (PROJECT.md §1, REQUIREMENTS.md §2):
// - Entitlement é a fonte da verdade; entre candidatos vence a maior priority
//   (BONUS=5 < CONTRACT=10 < SUBSCRIPTION=20 < LICENSE=30).
// - now <= expires_at (ou expires_at null = vitalícia) → ALLOW.
// - expires_at < now <= grace_until → ALLOW degradado (degraded:true).
// - now > grace_until (ou sem janela de graça) → DENY EXPIRED.
// - REVOKED nunca autoriza; SUSPENDED nega mesmo dentro da vigência.

export const ORIGIN_PRIORITY: Record<string, number> = {
  BONUS: 5,
  CONTRACT: 10,
  SUBSCRIPTION: 20,
  LICENSE: 30,
};

export type EntitlementCandidate = {
  id: string;
  ownerType: string;
  ownerId: string;
  productId: string;
  featureCode: string;
  channel?: string | null;
  origin: string;
  originId: string;
  priority: number;
  status: string;
  quotaValue: string | null;
  startsAt: Date | string | null;
  expiresAt: Date | string | null;
  graceUntil: Date | string | null;
};

export type Channel = 'WEB' | 'DESKTOP';

export type CheckDecision =
  | {
      allow: true;
      degraded: boolean;
      reason: 'ACTIVE' | 'LIFETIME' | 'GRACE';
      entitlementId: string;
      origin: string;
      priority: number;
      quotaValue: string | null;
    }
  | { allow: false; degraded: false; reason: 'NOT_FOUND' | 'REVOKED' | 'SUSPENDED' | 'EXPIRED' | 'CHANNEL_MISMATCH' };

function toTime(v: Date | string | null): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v as string);
  return Number.isNaN(t) ? null : t;
}

export function evaluateCheck(
  candidates: EntitlementCandidate[],
  now: Date = new Date(),
  channel?: Channel,
): CheckDecision {
  const eligible = candidates.filter((c) => c.status !== 'REVOKED');
  if (eligible.length === 0) {
    return { allow: false, degraded: false, reason: candidates.length > 0 ? 'REVOKED' : 'NOT_FOUND' };
  }
  // Fase 8: gating por canal. BOTH serve aos dois; canal ausente no legado = BOTH.
  // Candidato de outro canal nunca autoriza — nega com CHANNEL_MISMATCH
  // (distinto de NOT_FOUND: o direito existe, mas não neste canal).
  const inChannel = channel
    ? eligible.filter((c) => (c.channel ?? 'BOTH') === 'BOTH' || c.channel === channel)
    : eligible;
  if (inChannel.length === 0) {
    return { allow: false, degraded: false, reason: 'CHANNEL_MISMATCH' };
  }
  const top = [...inChannel].sort((a, b) => b.priority - a.priority)[0];
  if (top.status === 'SUSPENDED') {
    return { allow: false, degraded: false, reason: 'SUSPENDED' };
  }
  const nowMs = now.getTime();
  const exp = toTime(top.expiresAt);
  if (exp === null) {
    return {
      allow: true,
      degraded: false,
      reason: 'LIFETIME',
      entitlementId: top.id,
      origin: top.origin,
      priority: top.priority,
      quotaValue: top.quotaValue,
    };
  }
  if (nowMs <= exp) {
    return {
      allow: true,
      degraded: false,
      reason: 'ACTIVE',
      entitlementId: top.id,
      origin: top.origin,
      priority: top.priority,
      quotaValue: top.quotaValue,
    };
  }
  const grace = toTime(top.graceUntil);
  if (grace !== null && nowMs <= grace) {
    return {
      allow: true,
      degraded: true,
      reason: 'GRACE',
      entitlementId: top.id,
      origin: top.origin,
      priority: top.priority,
      quotaValue: top.quotaValue,
    };
  }
  return { allow: false, degraded: false, reason: 'EXPIRED' };
}
