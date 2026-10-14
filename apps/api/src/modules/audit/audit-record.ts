// Vocabulário de auditoria Fase 3 (PROJECT §§2/4, LGPD.md).
// Sem PII: metadata carrega SÓ `keyMasked` e/ou `device_hash` (+ campos
// operacionais como reason/tokenVersion/months). Sem chave plaintext,
// sem key_hash/key_enc, sem appInstanceId, sem IP.
// Fase 5 (aditivo): `finance.transaction.posted` + `finance.read.grant`
// (ator/org/motivo/valores operacionais — sem nome, e-mail ou documento).
export type AuditAction =
  | 'license.issue'
  | 'license.reveal'
  | 'license.renew'
  | 'license.revoke'
  | 'license.rotate'
  | 'device.link'
  | 'device.unlink'
  | 'device.block'
  | 'bonus.grant'
  | 'finance.transaction.posted'
  | 'finance.read.grant'
  | 'dlq.list'
  | 'dlq.replay';

export interface AuditEventInput {
  actorId?: string;
  action: AuditAction | string;
  entity: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface StoredAuditEvent {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// Allowlist estrita: tudo fora daqui é descartado antes de persistir.
// (Fase 5: + ator/org/valores operacionais do financeiro — sem PII.)
const SAFE_METADATA_KEYS = new Set([
  'keyMasked',
  'device_hash',
  'tokenVersion',
  'reason',
  'replacedBy',
  'months',
  'template',
  'eventId',
  'actorId',
  'orgId',
  'amountCents',
  'kind',
  'premisesHash',
  'horizonDays',
  'queue',
  'jobId',
  'page',
  'pageSize',
  'count',
  'duplicate',
  'dryRun',
  'policy',
  // Fase 6: correlação ponta-a-ponta (Outbox→BullMQ→Resend→Audit).
  // `correlationId` nunca é PII nem segredo — só correlação (REQUIREMENTS §4).
  'correlationId',
]);

/** Redige metadata para o mínimo auditável (allowlist; sem PII). */
export function sanitizeAuditMetadata(input?: Record<string, unknown>): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SAFE_METADATA_KEYS.has(k)) out[k] = v;
  }
  return out;
}
