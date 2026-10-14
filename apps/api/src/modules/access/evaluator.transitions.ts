// Transições puras do evaluator (PROJECT.md §1, REQUIREMENTS.md §2).
// Espelham 1:1 a semântica do sweep SQL em access-evaluator.service.ts,
// para que `evaluate(now)` seja testável sem banco:
// - ACTIVE com expires_at < now <= grace_until → GRACE.
// - (ACTIVE|GRACE) com now > grace_until (ou sem graça e expirado) → EXPIRED.
// - SUSPENDED nunca transiciona por tempo (só resume explícito via evento).
// - REVOKED/EXPIRED são terminais (nunca regridem, cf. PROJECT.md §5).
// - Vitalícias (expires_at null) nunca são tocadas.

export type LifecycleStatus = 'ACTIVE' | 'GRACE' | 'SUSPENDED' | 'EXPIRED' | 'REVOKED';

export interface DatedCandidate {
  id: string;
  status: string;
  expiresAt: Date | string | null;
  graceUntil: Date | string | null;
}

export const GRACE_DAYS = 3;
export const OFFLINE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function toMs(v: Date | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** PROJECT.md §1: grace_until = expires_at + 3d. */
export function graceUntilFor(expiresAt: Date): Date {
  return new Date(expiresAt.getTime() + GRACE_DAYS * DAY_MS);
}

/** PROJECT.md §1: off_exp = min(token_iat + 7d, expires_at + 7d). */
export function offlineExpiry(tokenIat: Date, expiresAt: Date): Date {
  return new Date(Math.min(tokenIat.getTime() + OFFLINE_DAYS * DAY_MS, expiresAt.getTime() + OFFLINE_DAYS * DAY_MS));
}

/**
 * Próximo status por passagem do tempo. Igualdade replica o SQL:
 * now == expires_at permanece ACTIVE (`"expiresAt" < now` estrito);
 * now == grace_until permanece GRACE (`"graceUntil" >= now`).
 */
export function nextStatusByTime(
  current: string,
  nowMs: number,
  expMs: number | null,
  graceMs: number | null,
): LifecycleStatus {
  if (current === 'REVOKED' || current === 'EXPIRED') return current;
  if (current === 'SUSPENDED') return 'SUSPENDED';
  if (current !== 'ACTIVE' && current !== 'GRACE') return current as LifecycleStatus;
  if (expMs === null) return 'ACTIVE';
  if (nowMs <= expMs) return 'ACTIVE';
  if (graceMs !== null && nowMs <= graceMs) return 'GRACE';
  return 'EXPIRED';
}

/** Resume explícito (evento LicenseRenewed / ação admin). Terminais nunca regridem. */
export function requestResume(current: string): LifecycleStatus {
  if (current === 'SUSPENDED') return 'ACTIVE';
  return current as LifecycleStatus;
}

export interface RowTransition {
  id: string;
  from: LifecycleStatus;
  to: LifecycleStatus;
  changed: boolean;
}

export function evaluateRow(row: DatedCandidate, now: Date = new Date()): RowTransition {
  const from = row.status as LifecycleStatus;
  const to = nextStatusByTime(row.status, now.getTime(), toMs(row.expiresAt), toMs(row.graceUntil));
  return { id: row.id, from, to, changed: from !== to };
}

export interface TransitionSummary {
  total: number;
  toGrace: number;
  toActive: number;
  toExpired: number;
  unchanged: number;
}

export function summarizeTransitions(results: RowTransition[]): TransitionSummary {
  const s: TransitionSummary = { total: results.length, toGrace: 0, toActive: 0, toExpired: 0, unchanged: 0 };
  for (const r of results) {
    if (!r.changed) {
      s.unchanged += 1;
      continue;
    }
    if (r.to === 'GRACE') s.toGrace += 1;
    else if (r.to === 'ACTIVE') s.toActive += 1;
    else if (r.to === 'EXPIRED') s.toExpired += 1;
  }
  return s;
}

/**
 * Chaves de cache a invalidar por (owner, product, feature).
 * Fase 8: a chave canônica carrega o canal (`...:F1:WEB|:DESKTOP|:ANY`) —
 * invalidar UMA concessão exige derrubar as 3 variantes + o alias curto
 * `access:{owner}:{product}:{feature}` (contrato da Fase 3).
 */
export function accessCacheKeys(
  ownerType: string,
  ownerId: string,
  productId: string,
  featureCode: string,
): string[] {
  const base = `access:check:v1:${ownerType}:${ownerId}:${productId}:${featureCode}`;
  return [`${base}:WEB`, `${base}:DESKTOP`, `${base}:ANY`, `access:${ownerId}:${productId}:${featureCode}`];
}
