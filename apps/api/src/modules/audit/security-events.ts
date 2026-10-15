// Helper de trilha de segurança (E7, Fase 9): escrita em
// `audit.security_events` (DDL: prisma/audit/migrations/0002_*).
// - SÓ INSERT (append-only; o papel da app tem só INSERT+SELECT).
// - Fire-and-forget seguro: pool ausente → no-op; falha de INSERT →
//   engolida (NUNCA quebra guards/decisões dos chamadores — usar `void`).
// - metadata por allowlist estrita (sem PII): nada de e-mail, IP cru,
//   chave/token/senha, appInstanceId ou hashes de busca.

/** Vocabulário fechado (CHECK no DDL — manter os 6 em sincronia). */
export const SECURITY_EVENT_TYPES = [
  'LOGIN_FAILED',
  'MFA_FAILED',
  'TOKEN_ROTATED',
  'DEVICE_BLOCKED',
  'CLONE_SUSPECT',
  'KEY_REVEALED',
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export interface SecurityEventInput {
  type: SecurityEventType;
  actorId?: string;
  entity?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/** Pool mínimo p/ o INSERT (aceita `pg.Pool` ou mock `{ query }`). */
export interface SecurityEventPool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows?: Array<Record<string, unknown>>; rowCount?: number | null }>;
}

// Allowlist estrita: tudo fora daqui é descartado antes de persistir.
// Operacionais opacos + correlação — sem PII, sem segredo, sem localização.
const SAFE_SECURITY_METADATA_KEYS = new Set([
  'reason', // ex.: INVALID_CREDENTIALS, ACCOUNT_LOCKED, REUSE_DETECTED, ROTATED
  'reasons', // ex.: ['ctr-rollback', 'impossible-travel'] (sinais de clone)
  'keyMasked', // máscara de exibição (nunca plaintext/hash/cifra)
  'device_hash', // HMAC opaco (nunca hardware cru/appInstanceId)
  'familyId', // família de refresh (opaca; rotação/reuso)
  'correlationId', // correlação ponta-a-ponta (REQUIREMENTS §4)
]);

/** Redige metadata para o mínimo auditável (allowlist; sem PII). */
export function sanitizeSecurityMetadata(
  input?: Record<string, unknown>,
): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SAFE_SECURITY_METADATA_KEYS.has(k)) out[k] = v;
  }
  return out;
}

export function isSecurityEventType(v: unknown): v is SecurityEventType {
  return (
    typeof v === 'string' &&
    (SECURITY_EVENT_TYPES as readonly string[]).includes(v)
  );
}

let defaultPool: SecurityEventPool | undefined;
let defaultPoolAttempted = false;

/**
 * Pool lazy do banco audit (DATABASE_URL_AUDIT). `new Pool()` não conecta de
 * forma ansiosa — seguro no boot/testes sem banco. Sem env → undefined
 * (emit vira no-op). Chamadores passam o retorno direto p/ emitSecurityEvent.
 */
export function getSecurityEventPool(): SecurityEventPool | undefined {
  if (defaultPoolAttempted) return defaultPool;
  defaultPoolAttempted = true;
  const cs = process.env.DATABASE_URL_AUDIT;
  if (!cs) return undefined;
  // Lazy-require p/ não custar import em testes sem `pg` instalado/resolvido.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg') as typeof import('pg');
  defaultPool = new Pool({
    connectionString: cs,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  }) as SecurityEventPool;
  return defaultPool;
}

/** Uso em testes p/ resetar/injetar o singleton lazy. */
export function __setSecurityEventPoolForTests(
  pool: SecurityEventPool | undefined,
): void {
  defaultPool = pool;
  defaultPoolAttempted = pool !== undefined;
}

/**
 * Persiste UM evento de segurança. SÓ INSERT em `audit.security_events`
 * (schema-qualificado — independe do search_path da conexão).
 * - Tipo fora do vocabulário → throw (erro de programador, fail-fast).
 * - Pool ausente ou INSERT falhou → resolve sem throw (a trilha nunca pode
 *   mudar a decisão do fluxo chamador: login/refresh/reveal seguem iguais).
 */
export async function emitSecurityEvent(
  pool: SecurityEventPool | null | undefined,
  input: SecurityEventInput,
): Promise<void> {
  if (!isSecurityEventType(input?.type)) {
    throw new Error(
      `security event type inválido: ${String((input as { type?: unknown } | undefined)?.type)}`,
    );
  }
  const active = pool ?? getSecurityEventPool();
  if (!active) return;
  const meta = sanitizeSecurityMetadata(input.metadata);
  try {
    await active.query(
      `INSERT INTO audit.security_events (id, type, "actorId", entity, "entityId", metadata, "createdAt") ` +
        `VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::jsonb, now())`,
      [
        input.type,
        input.actorId ?? null,
        input.entity ?? null,
        input.entityId ?? null,
        JSON.stringify(meta),
      ],
    );
  } catch {
    // Trilha best-effort: falha de auditoria nunca quebra o fluxo.
  }
}
