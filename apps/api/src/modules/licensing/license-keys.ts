import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

// Helpers puros do Licensing core (PROJECT.md §§1-2, REQUIREMENTS.md §2).
// Sem I/O, sem Nest — cobertos por unit test (`license-keys.spec.ts`).
// Convenções copiadas 1:1 de libs/security (apps/api compila com rootDir
// próprio e não importa o pacote — mesmo padrão de `auth/rate-limit.ts`).

export type LicenseKind = 'monthly' | 'annual' | 'lifetime';
export type LicenseStatus =
  | 'pending_payment'
  | 'active'
  | 'grace'
  | 'suspended'
  | 'expired'
  | 'revoked';

/** Janela de tolerância degradada (PROJECT.md §1). */
export const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** Alfabeto sem ambiguidade (sem I, O, 0, 1) p/ o display da chave. */
export const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const KEY_FORMAT = /^AURUM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/**
 * Gera chave `AURUM-XXXX-XXXX-XXXX` a partir de fonte CSPRNG de 128 bits.
 * O display carrega 12 chars × 5 bits = 60 bits efetivos (suficiente p/
 * escala de chaves; colisão é barrada por UNIQUE(key_hash) + retry no
 * service). `rand` é injetável p/ determinismo em teste.
 */
export function generateLicenseKey(rand: (n: number) => Buffer = randomBytes): string {
  const src = rand(16); // 128-bit CSPRNG
  let acc = 0;
  let bits = 0;
  let pos = 0;
  let out = '';
  for (let i = 0; i < 12; i++) {
    while (bits < 5) {
      acc = (acc << 8) | src[pos % src.length];
      pos += 1;
      bits += 8;
    }
    bits -= 5;
    out += KEY_ALPHABET[(acc >>> bits) & 31];
    acc &= (1 << bits) - 1;
  }
  return `AURUM-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

/** SHA-256 hex p/ `key_hash` (índice UNIQUE). Nunca plaintext no DB. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * `AURUM-XXXX-XXXX-AB12` → `AURUM-••••-••••-AB12` (só last4 visível).
 * Entrada fora do padrão vira máscara total. Espelha libs/security.
 */
export function maskLicenseKey(key: string): string {
  const m = key.match(/^([A-Z]+)-([A-Za-z0-9]+)-([A-Za-z0-9]+)-([A-Za-z0-9]{4})$/);
  if (!m) return '••••';
  return `${m[1]}-••••-••••-${m[4]}`;
}

/** Máscara só com as partes armazenadas (prefixo nunca exibido). */
export function maskFromParts(last4: string): string {
  const tail = (last4 ?? '').slice(-4) || '••••';
  return `AURUM-••••-••••-${tail}`;
}

/**
 * Expiração determinística pura (PROJECT.md §1 + Fase 8 lifetime):
 * `expires_at` = starts_at + 1M/12M calendário UTC, `grace_until` = +3d.
 * `lifetime` (desktop perpétuo, ONE_TIME) não expira: ambas null.
 * Leitores tratam null como vitalícia (effectiveStatus → active,
 * check-access → LIFETIME). Não muta a entrada.
 */
export function calcExpiry(
  startsAt: Date,
  kind: LicenseKind,
): { expiresAt: Date | null; graceUntil: Date | null } {
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime())) {
    throw new Error('calcExpiry: startsAt inválido.');
  }
  if (kind !== 'monthly' && kind !== 'annual' && kind !== 'lifetime') {
    throw new Error(`calcExpiry: kind inválido (${String(kind)}).`);
  }
  if (kind === 'lifetime') return { expiresAt: null, graceUntil: null };
  const months = kind === 'annual' ? 12 : 1;
  const expiresAt = new Date(
    Date.UTC(
      startsAt.getUTCFullYear(),
      startsAt.getUTCMonth() + months,
      startsAt.getUTCDate(),
      startsAt.getUTCHours(),
      startsAt.getUTCMinutes(),
      startsAt.getUTCSeconds(),
      startsAt.getUTCMilliseconds(),
    ),
  );
  return { expiresAt, graceUntil: new Date(expiresAt.getTime() + GRACE_MS) };
}

/**
 * Intervalo comercial (billing) → kind de licença. Erro em valor
 * desconhecido (fail-closed: nunca adivinhar vigência).
 * MONTH → monthly, YEAR → annual, ONE_TIME → lifetime.
 */
export function kindForBillingInterval(v: string): LicenseKind {
  if (v === 'ONE_TIME') return 'lifetime';
  if (v === 'YEAR') return 'annual';
  if (v === 'MONTH') return 'monthly';
  throw new Error(`kindForBillingInterval: intervalo inválido (${String(v)}).`);
}

/**
 * Status efetivo na leitura: lifecycle persistido (suspended/revoked/
 * pending_payment) vence; active deriva grace/expired das datas
 * (PROJECT.md §1). `now` injetável p/ determinismo em teste.
 */
export function effectiveStatus(
  row: { status: string; expiresAt: Date | string | null; graceUntil: Date | string | null },
  now: Date = new Date(),
): LicenseStatus {
  if (row.status === 'suspended' || row.status === 'revoked' || row.status === 'pending_payment') {
    return row.status;
  }
  const nowMs = now.getTime();
  const exp = toTime(row.expiresAt);
  if (exp === null) return 'active';
  if (nowMs <= exp) return 'active';
  const grace = toTime(row.graceUntil);
  if (grace !== null && nowMs <= grace) return 'grace';
  return 'expired';
}

function toTime(v: Date | string | null): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/**
 * Cifra a chave p/ `key_enc` (AES-256-GCM, formato `v1.<iv>.<ct>.<tag>` b64).
 * Chave via env `LICENSE_KEY_ENC_KEY` (64 hex chars, 256 bits, KMS na Fase 5).
 * Sem segredo configurado → null (reveal fica indisponível: 409).
 */
export function encryptLicenseKey(plaintext: string): string | null {
  const k = encKey();
  if (!k) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`;
}

/** Decifra `key_enc`. Erro (formato/auth) → throw (reveal nega, sem vazar motivo). */
export function decryptLicenseKey(payload: string): string {
  const k = encKey();
  if (!k) throw new Error('segredo de cifra ausente');
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('formato key_enc inválido');
  const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[3], 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[2], 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function encKey(): Buffer | null {
  const raw = process.env.LICENSE_KEY_ENC_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}
