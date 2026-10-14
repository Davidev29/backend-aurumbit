// Mapeamento puro Licensing → Access (Fase 3).
// Sem I/O: transforma envelopes `licensing.*.v1` em upserts de Entitlement
// (origin=LICENSE, priority 30) + plano de cascata de revogação + outbox.
// Regras honradas:
// - PROJECT.md §1: grace_until = expires_at + 3d; renovação em grace mantém
//   continuidade (starts_at = max(now, expires_at_anterior)).
// - PROJECT.md §5: nunca regredir estado terminal (REVOKED/EXPIRED); evento
//   antigo fora de ordem não reativa; idempotência por UNIQUE(eventId) no
//   outbox + UNIQUE 6-col do entitlement + chave `grant:<paymentId>:<id>`.
// - REQUIREMENTS.md §2: LICENSE priority 30 vence BONUS/CONTRACT/SUBSCRIPTION.

import { graceUntilFor } from './evaluator.transitions';

export const LICENSE_TOPICS = [
  'licensing.license.issued.v1',
  'licensing.license.renewed.v1',
  'licensing.license.revoked.v1',
  'licensing.license.suspended.v1',
  'licensing.device.linked.v1',
  'licensing.device.unlinked.v1',
  'licensing.device.clone_suspect.v1',
] as const;

export type LicenseEventKind =
  | 'issued'
  | 'renewed'
  | 'revoked'
  | 'suspended'
  | 'device-linked'
  | 'device-unlinked'
  | 'clone-suspect';

const KIND_BY_TOPIC: Record<string, LicenseEventKind> = {
  'licensing.license.issued.v1': 'issued',
  'licensing.license.renewed.v1': 'renewed',
  'licensing.license.revoked.v1': 'revoked',
  'licensing.license.suspended.v1': 'suspended',
  'licensing.device.linked.v1': 'device-linked',
  'licensing.device.unlinked.v1': 'device-unlinked',
  'licensing.device.clone_suspect.v1': 'clone-suspect',
};

export function kindForTopic(topic: string): LicenseEventKind | null {
  return KIND_BY_TOPIC[topic] ?? null;
}

export interface LicenseEnvelope {
  eventId: string;
  topic: string;
  version: number;
  occurredAt: string;
  payload: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export type ParseOk = { ok: true; envelope: LicenseEnvelope; kind: LicenseEventKind };
export type ParseFail = { ok: false; errors: string[] };

/** Validação defensiva: nunca lança, ignora campos desconhecidos (forward-compatible). */
export function parseLicenseEnvelope(raw: unknown): ParseOk | ParseFail {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['envelope inválido'] };
  const eventId = asStr(raw.eventId);
  if (!eventId || eventId.length < 8) errors.push('eventId inválido');
  const topic = asStr(raw.topic);
  const kind = topic ? kindForTopic(topic) : null;
  if (!kind) errors.push(`topic desconhecido: ${String(raw.topic)}`);
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) errors.push('version deve ser inteiro >= 1');
  const occurredAt = asStr(raw.occurredAt);
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) errors.push('occurredAt deve ser ISO-8601');
  if (!isRecord(raw.payload)) errors.push('payload deve ser objeto');
  if (errors.length > 0 || !kind) return { ok: false, errors };
  const payload = raw.payload as Record<string, unknown>;
  const needsOwner = kind === 'issued' || kind === 'renewed';
  if (!asStr(payload.licenseId)) errors.push('payload.licenseId obrigatório');
  if (needsOwner && !asStr(payload.ownerId)) errors.push('payload.ownerId obrigatório p/ issued/renewed');
  if (needsOwner && !asStr(payload.productId)) errors.push('payload.productId obrigatório p/ issued/renewed');
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    kind,
    envelope: {
      eventId: eventId as string,
      topic: topic as string,
      version: raw.version as number,
      occurredAt: occurredAt as string,
      payload,
    },
  };
}

export interface LicenseEntitlementUpsert {
  ownerType: string;
  ownerId: string;
  productId: string;
  featureCode: string;
  /** Fase 8: canal denormalizado (default BOTH = legado). */
  channel: 'WEB' | 'DESKTOP' | 'BOTH';
  /** Fase 8: lifetime → LICENSE/30; mensal/anual → SUBSCRIPTION/20;
   *  legado sem kind → LICENSE/30. */
  origin: 'LICENSE' | 'SUBSCRIPTION';
  originId: string;
  priority: 30 | 20;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  startsAt: string | null;
  expiresAt: string | null;
  graceUntil: string | null;
  /** true quando sem feature explícita (fan-out produto→features acontece na Fase 4 via catálogo). */
  wildcard: boolean;
}

/**
 * Features cobertas pelo evento. Ordem: featureCode explícito > lista
 * featureCodes > curinga `*` (idempotente via UNIQUE 6-col do entitlement).
 */
export function featureCodesFor(payload: Record<string, unknown>): { codes: string[]; wildcard: boolean } {
  const single = asStr(payload.featureCode);
  if (single) return { codes: [single], wildcard: false };
  if (Array.isArray(payload.featureCodes)) {
    const codes = payload.featureCodes.filter((c): c is string => typeof c === 'string' && c.length > 0);
    if (codes.length > 0) return { codes: [...new Set(codes)], wildcard: false };
  }
  return { codes: ['*'], wildcard: true };
}

/**
 * Canais por feature no envelope. Ordem: `channels` paralelo a `codes`
 * (índice a índice) > `channel` único p/ todas > BOTH (legado).
 * Valor fora de WEB|DESKTOP|BOTH cai p/ BOTH (fail-open legado, nunca nega).
 */
export function featureChannelsFor(
  payload: Record<string, unknown>,
  codes: string[],
): Array<'WEB' | 'DESKTOP' | 'BOTH'> {
  const norm = (v: unknown): 'WEB' | 'DESKTOP' | 'BOTH' =>
    v === 'WEB' || v === 'DESKTOP' ? v : 'BOTH';
  if (Array.isArray(payload.channels)) {
    const list: unknown[] = payload.channels;
    return codes.map((_, i) => norm(list[i]));
  }
  const single = norm(payload.channel);
  return codes.map(() => single);
}

/**
 * Origem/prioridade comercial (Fase 8) a partir do license kind do payload.
 * Lifetime (perpétua) vence assinatura — espelha ORIGIN_PRIORITY.
 */
export function originForLicenseKind(kind: unknown): { origin: 'LICENSE' | 'SUBSCRIPTION'; priority: 30 | 20 } {
  if (kind === 'lifetime') return { origin: 'LICENSE', priority: 30 };
  if (kind === 'monthly' || kind === 'annual') return { origin: 'SUBSCRIPTION', priority: 20 };
  return { origin: 'LICENSE', priority: 30 }; // legado sem kind
}

function isoOrNull(v: unknown): string | null {
  const s = asStr(v);
  if (!s || Number.isNaN(Date.parse(s))) return null;
  return new Date(s).toISOString();
}

/**
 * Mapeia issued/renewed/revoked/suspended → upsert(s) de Entitlement.
 * Device/clone retornam null (só invalidam cache; sem reescrita de vigência).
 */
export function entitlementUpsertsFor(
  envelope: LicenseEnvelope,
  kind: LicenseEventKind,
  now: Date = new Date(),
): LicenseEntitlementUpsert[] | null {
  if (kind === 'device-linked' || kind === 'device-unlinked' || kind === 'clone-suspect') return null;
  const p = envelope.payload;
  const licenseId = asStr(p.licenseId) as string;
  const ownerId = asStr(p.ownerId) as string;
  const productId = asStr(p.productId) as string;
  const ownerType = asStr(p.ownerType) ?? 'CUSTOMER';
  const { codes, wildcard } = featureCodesFor(p);

  let status: LicenseEntitlementUpsert['status'] = 'ACTIVE';
  let startsAt: string | null = isoOrNull(p.startsAt) ?? envelope.occurredAt;
  let expiresAt: string | null = isoOrNull(p.expiresAt);
  let graceUntil: string | null = isoOrNull(p.graceUntil);

  if (kind === 'revoked') {
    status = 'REVOKED';
  } else if (kind === 'suspended') {
    status = 'SUSPENDED';
  } else if (kind === 'renewed') {
    // Continuidade §1: starts_at = max(now, expires_at_anterior).
    const prev = isoOrNull(p.prevExpiresAt);
    if (prev) {
      const base = Math.max(now.getTime(), Date.parse(prev));
      startsAt = new Date(base).toISOString();
    }
  }
  if ((kind === 'issued' || kind === 'renewed') && !graceUntil && expiresAt) {
    graceUntil = graceUntilFor(new Date(expiresAt)).toISOString();
  }
  const { origin, priority } = originForLicenseKind(p.kind);
  const channels = featureChannelsFor(p, codes);
  return codes.map((featureCode, i) => ({
    ownerType,
    ownerId,
    productId,
    featureCode,
    channel: channels[i],
    origin,
    originId: licenseId,
    priority,
    status,
    startsAt,
    expiresAt,
    graceUntil,
    wildcard,
  }));
}

// ---------------------------------------------------------------------------
// Idempotência (PROJECT.md §5)
// ---------------------------------------------------------------------------

/** BullMQ jobId / chave de dedupe: sempre o eventId do envelope. */
export function jobIdForEvent(eventId: string): string {
  return eventId;
}

/** Grant sem duplicar: mesma (paymentId, licenseId) → mesma chave/outbox eventId. */
export function grantIdempotencyKey(paymentId: string, licenseId: string): string {
  return `grant:${paymentId}:${licenseId}`;
}

/** EventIds determinísticos da cascata: replay do mesmo gatilho não duplica. */
export function cascadeEventId(base: string, scope: string, id: string): string {
  return `${base}:${scope}:${id}`;
}

// ---------------------------------------------------------------------------
// Cascata de revogação (funções puras)
// Contract cancel → Item CANCELLED → Entitlement REVOKED → License REVOKED +
// token_version++. Item usa CANCELLED porque ITEM_FLOW não tem estado REVOKED.
// ---------------------------------------------------------------------------

export interface CascadeItemInput {
  itemId: string;
  productId: string;
  featureCode?: string;
  licenseId?: string | null;
  ownerType: string;
  ownerId: string;
  paymentId?: string | null;
  prevTokenVersion?: number | null;
  currentItemStatus: string;
  currentEntitlementStatus?: string | null;
  currentLicenseStatus?: string | null;
}

export interface CascadeInput {
  contractId: string;
  currentContractStatus: string;
  actor: string;
  reason: string;
  triggerEventId?: string;
  occurredAt?: string;
  items: CascadeItemInput[];
}

export interface CascadeOp {
  scope: 'contract' | 'item' | 'entitlement' | 'license';
  id: string;
  from: string | null;
  to: string;
  applied: boolean;
  note?: string;
  tokenVersion?: number;
}

export interface CascadeOutboxRow {
  eventId: string;
  domain: 'access' | 'licensing';
  aggregate: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface RevocationPlan {
  contract: CascadeOp;
  items: CascadeOp[];
  entitlements: CascadeOp[];
  licenses: CascadeOp[];
  outbox: CascadeOutboxRow[];
}

const CONTRACT_TERMINAL = new Set(['CANCELLED', 'EXPIRED']);
const CONTRACT_CANCELLABLE = new Set(['DRAFT', 'ACTIVE', 'SUSPENDED']);
const ITEM_TERMINAL = new Set(['CANCELLED', 'EXPIRED']);

export function planRevocationCascade(input: CascadeInput): RevocationPlan {
  const now = input.occurredAt ?? new Date().toISOString();
  const base = input.triggerEventId ?? `revoke:${input.contractId}`;
  const plan: RevocationPlan = { contract: null as unknown as CascadeOp, items: [], entitlements: [], licenses: [], outbox: [] };

  if (CONTRACT_TERMINAL.has(input.currentContractStatus)) {
    plan.contract = { scope: 'contract', id: input.contractId, from: input.currentContractStatus, to: input.currentContractStatus, applied: false, note: 'já terminal' };
  } else if (CONTRACT_CANCELLABLE.has(input.currentContractStatus)) {
    plan.contract = { scope: 'contract', id: input.contractId, from: input.currentContractStatus, to: 'CANCELLED', applied: true };
  } else {
    plan.contract = { scope: 'contract', id: input.contractId, from: input.currentContractStatus, to: input.currentContractStatus, applied: false, note: 'estado desconhecido, sem transição' };
  }

  for (const item of input.items) {
    const featureCode = item.featureCode ?? '*';
    if (ITEM_TERMINAL.has(item.currentItemStatus)) {
      plan.items.push({ scope: 'item', id: item.itemId, from: item.currentItemStatus, to: item.currentItemStatus, applied: false, note: 'já terminal' });
    } else {
      plan.items.push({ scope: 'item', id: item.itemId, from: item.currentItemStatus, to: 'CANCELLED', applied: true, note: 'item revoked ≡ CANCELLED' });
    }

    const entFrom = item.currentEntitlementStatus ?? 'ACTIVE';
    if (entFrom === 'REVOKED') {
      plan.entitlements.push({ scope: 'entitlement', id: `${item.ownerId}:${item.productId}:${featureCode}`, from: entFrom, to: entFrom, applied: false, note: 'já terminal' });
    } else {
      plan.entitlements.push({ scope: 'entitlement', id: `${item.ownerId}:${item.productId}:${featureCode}`, from: entFrom, to: 'REVOKED', applied: true });
      plan.outbox.push({
        eventId: cascadeEventId(base, 'ent', `${item.itemId}:${featureCode}`),
        domain: 'access',
        aggregate: 'entitlement',
        aggregateId: item.itemId,
        type: 'access.entitlement.updated.v1',
        payload: {
          ownerType: item.ownerType,
          ownerId: item.ownerId,
          productId: item.productId,
          featureCode,
          origin: 'LICENSE',
          originId: item.licenseId ?? item.itemId,
          status: 'REVOKED',
          reason: input.reason,
          actor: input.actor,
          grantKey: item.paymentId && item.licenseId ? grantIdempotencyKey(item.paymentId, item.licenseId) : null,
        },
        occurredAt: now,
      });
    }

    if (item.licenseId) {
      const licFrom = item.currentLicenseStatus ?? 'ACTIVE';
      if (licFrom === 'REVOKED') {
        plan.licenses.push({ scope: 'license', id: item.licenseId, from: licFrom, to: licFrom, applied: false, note: 'já terminal' });
      } else {
        const tokenVersion = (item.prevTokenVersion ?? 0) + 1;
        plan.licenses.push({ scope: 'license', id: item.licenseId, from: licFrom, to: 'REVOKED', applied: true, tokenVersion });
        plan.outbox.push({
          eventId: cascadeEventId(base, 'lic', item.licenseId),
          domain: 'licensing',
          aggregate: 'license',
          aggregateId: item.licenseId,
          type: 'licensing.license.revoked.v1',
          payload: { licenseId: item.licenseId, status: 'REVOKED', tokenVersion, reason: input.reason, actor: input.actor },
          occurredAt: now,
        });
      }
    }
  }
  return plan;
}
