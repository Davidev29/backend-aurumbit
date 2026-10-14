import { createHmac, timingSafeEqual } from 'node:crypto';

// Token offline (PROJECT.md §1, ADR-003). Autocontido em apps/api.
// - `off_exp = min(iat + 7d, expires_at + 7d)`: teto de 7 dias sem contato,
//   nunca estende a validade além de +7d da expiração.
// - Precedência (grace vence offline): status → token_version → EXPIRED
//   (now > grace_until, mesmo com off_exp válido) → OFFLINE_EXPIRED → ALLOW.
export const OFFLINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const GRACE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** Sentinela lifetime em tokens (JSON-safe): sem expiração/graça. */
export const LIFETIME_SENTINEL_MS = Number.MAX_SAFE_INTEGER;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Soma meses de calendário em UTC: `expires_at = starts_at + 1M/12M`. */
export function addMonthsUTC(base: Date, months: number): Date {
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth() + months,
      base.getUTCDate(),
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
}

export function addDaysMs(baseMs: number, days: number): number {
  return baseMs + days * DAY_MS;
}

/** `off_exp = min(iat + 7d, expires_at + 7d)` (ms epoch). */
export function computeOffExpMs(iatMs: number, expiresAtMs: number): number {
  return Math.min(iatMs + OFFLINE_WINDOW_MS, expiresAtMs + OFFLINE_WINDOW_MS);
}

export interface OfflinePayload {
  /** license id opaco. */
  lid: string;
  /** token_version no mint (revogação bump → mismatch no próximo online). */
  tv: number;
  /** issued-at do token (ms epoch). */
  iat: number;
  /** lic_exp = expires_at (ms epoch). Lifetime: 0 (sem expiração). */
  exp: number;
  /** grace_until (ms epoch). Lifetime: 0. */
  grace: number;
  /** off_exp (ms epoch). */
  off: number;
  /** Fase 8: canais licenciados (default ['BOTH'] p/ tokens antigos).
   *  O app compara com seu próprio canal; adulteração quebra o HMAC. */
  ch: Array<'WEB' | 'DESKTOP' | 'BOTH'>;
}

const KNOWN_CHANNELS = new Set(['WEB', 'DESKTOP', 'BOTH']);

function offlineSecret(): string {
  const s = process.env.OFFLINE_TOKEN_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('OFFLINE_TOKEN_SECRET ausente em produção (fail-fast).');
    }
    return 'test-only-offline-secret-min-16';
  }
  return s;
}

function b64urlEncode(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function b64urlDecode(b64: string): string {
  return Buffer.from(b64, 'base64url').toString('utf8');
}

/** Minta token offline HMAC (payload + assinatura, sem JWT lib). */
export function mintOfflineToken(input: {
  licenseId: string;
  tokenVersion: number;
  iatMs: number;
  /** null = lifetime (sentinela MAX_SAFE_INTEGER; JSON-safe, off_exp = iat+7d). */
  expiresAtMs: number | null;
  /** null = lifetime (sentinela). */
  graceUntilMs: number | null;
  /** default ['BOTH'] (legado / sem gating). */
  channels?: Array<'WEB' | 'DESKTOP' | 'BOTH'>;
}): { token: string; offExpMs: number } {
  const exp = input.expiresAtMs ?? LIFETIME_SENTINEL_MS;
  const grace = input.graceUntilMs ?? LIFETIME_SENTINEL_MS;
  const off = computeOffExpMs(input.iatMs, exp);
  const ch = input.channels && input.channels.length > 0 ? [...new Set(input.channels)] : ['BOTH' as const];
  const payload: OfflinePayload = {
    lid: input.licenseId,
    tv: input.tokenVersion,
    iat: input.iatMs,
    exp,
    grace,
    off,
    ch,
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', offlineSecret()).update(body, 'utf8').digest('base64url');
  return { token: `${body}.${sig}`, offExpMs: off };
}

/** Verifica assinatura e decodifica. Falha fechada: lança `INVALID_TOKEN`. */
export function parseOfflineToken(token: string): OfflinePayload {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new Error('INVALID_TOKEN');
  let payload: OfflinePayload;
  try {
    payload = JSON.parse(b64urlDecode(body)) as OfflinePayload;
  } catch {
    throw new Error('INVALID_TOKEN');
  }
  if (
    typeof payload.lid !== 'string' ||
    typeof payload.tv !== 'number' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    typeof payload.grace !== 'number' ||
    typeof payload.off !== 'number'
  ) {
    throw new Error('INVALID_TOKEN');
  }
  // `ch` ausente = token antigo → BOTH (compat, sem quebrar clientes);
  // presente e malformado → INVALID (fail-closed).
  if (payload.ch === undefined) {
    payload.ch = ['BOTH'];
  } else if (
    !Array.isArray(payload.ch) ||
    payload.ch.length === 0 ||
    !payload.ch.every((c) => typeof c === 'string' && KNOWN_CHANNELS.has(c))
  ) {
    throw new Error('INVALID_TOKEN');
  }
  // Recomputa off_exp do lado do servidor: cliente nunca estende a janela.
  const expectedOff = computeOffExpMs(payload.iat, payload.exp);
  if (payload.off !== expectedOff) throw new Error('INVALID_TOKEN');
  const want = createHmac('sha256', offlineSecret()).update(body, 'utf8').digest();
  const got = Buffer.from(sig, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    throw new Error('INVALID_TOKEN');
  }
  return payload;
}

/**
 * Gating por canal no app (Fase 8): o token carrega os canais licenciados.
 * BOTH atende qualquer canal; token sem o canal do app → negar localmente
 * (o servidor já negou no online via check-access; isto é defesa em
 * profundidade offline). Uso: `offlineChannelAllows(parseOfflineToken(t), 'DESKTOP')`.
 */
export function offlineChannelAllows(
  payload: OfflinePayload,
  channel: 'WEB' | 'DESKTOP',
): boolean {
  const ch = payload.ch ?? ['BOTH'];
  return ch.includes('BOTH') || (ch as string[]).includes(channel);
}

export type OfflineReason =
  | 'ACTIVE'
  | 'GRACE'
  | 'EXPIRED'
  | 'OFFLINE_EXPIRED'
  | 'REVOKED'
  | 'SUSPENDED'
  | 'TOKEN_VERSION_MISMATCH';

export interface OfflineDecision {
  allow: boolean;
  degraded: boolean;
  reason: OfflineReason;
  errorCode?: string;
}

/**
 * Validação offline no app (PROJECT §1):
 * - `now <= lic_exp` e `now <= off_exp` → ALLOW
 * - `lic_exp < now <= grace_until` e `now <= off_exp` → ALLOW degradado
 * - `now > grace_until` → DENY EXPIRED (mesmo se `now <= off_exp`)
 * - `now > off_exp` → DENY OFFLINE_EXPIRED (exige online)
 */
export function evaluateOfflineStatus(input: {
  nowMs: number;
  licExpMs: number;
  graceUntilMs: number;
  offExpMs: number;
  status: string;
  tokenVersion: number;
  expectedTokenVersion: number;
}): OfflineDecision {
  if (input.status === 'revoked') {
    return { allow: false, degraded: false, reason: 'REVOKED', errorCode: 'REVOKED' };
  }
  if (input.status === 'suspended') {
    return { allow: false, degraded: false, reason: 'SUSPENDED', errorCode: 'SUSPENDED' };
  }
  if (input.tokenVersion !== input.expectedTokenVersion) {
    return {
      allow: false,
      degraded: false,
      reason: 'TOKEN_VERSION_MISMATCH',
      errorCode: 'TOKEN_VERSION_MISMATCH',
    };
  }
  // Grace vence offline: licença morta não volta nem com janela offline válida.
  if (input.nowMs > input.graceUntilMs) {
    return { allow: false, degraded: false, reason: 'EXPIRED', errorCode: 'EXPIRED' };
  }
  if (input.nowMs > input.offExpMs) {
    return {
      allow: false,
      degraded: false,
      reason: 'OFFLINE_EXPIRED',
      errorCode: 'OFFLINE_EXPIRED',
    };
  }
  if (input.nowMs <= input.licExpMs) {
    return { allow: true, degraded: false, reason: 'ACTIVE' };
  }
  return { allow: true, degraded: true, reason: 'GRACE' };
}
