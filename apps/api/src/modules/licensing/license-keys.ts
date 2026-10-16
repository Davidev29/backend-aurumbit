import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

// Helpers puros do Licensing core (PROJECT.md §§1-2, REQUIREMENTS.md §2).
// Sem I/O, sem Nest — cobertos por unit test (`license-keys.spec.ts`).
// Convenções copiadas 1:1 de libs/security (apps/api compila com rootDir
// próprio e não importa o pacote — mesmo padrão de `auth/rate-limit.ts`).

export type LicenseKind = 'monthly' | 'annual' | 'lifetime' | 'trial';
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
  opts?: { expiresInHours?: number; expiresAt?: Date },
): { expiresAt: Date | null; graceUntil: Date | null } {
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime())) {
    throw new Error('calcExpiry: startsAt inválido.');
  }
  if (kind !== 'monthly' && kind !== 'annual' && kind !== 'lifetime' && kind !== 'trial') {
    throw new Error(`calcExpiry: kind inválido (${String(kind)}).`);
  }
  if (kind === 'lifetime') return { expiresAt: null, graceUntil: null };
  // Trial/demo/promo: expiração explícita em horas ou data absoluta.
  // Sem graça extra (graceUntil = expiresAt) — demo curta não herda 3d.
  if (kind === 'trial') {
    let expiresAt: Date | null = null;
    if (opts?.expiresAt instanceof Date && !Number.isNaN(opts.expiresAt.getTime())) {
      expiresAt = opts.expiresAt;
    } else if (typeof opts?.expiresInHours === 'number' && Number.isFinite(opts.expiresInHours)) {
      if (opts.expiresInHours < 1 || opts.expiresInHours > 24 * 365) {
        throw new Error('calcExpiry: expiresInHours deve estar entre 1h e 8760h (1 ano).');
      }
      expiresAt = new Date(startsAt.getTime() + Math.round(opts.expiresInHours * 3600_000));
    } else {
      throw new Error('calcExpiry: trial exige expiresInHours (1..8760) ou expiresAt.');
    }
    if (!expiresAt || expiresAt.getTime() <= startsAt.getTime()) {
      throw new Error('calcExpiry: trial expiresAt deve ser futuro.');
    }
    return { expiresAt, graceUntil: expiresAt };
  }
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
 * Cifra a chave p/ `key_enc` (envelope AES-256-GCM):
 * `v2.<masterVer>.<encDEK b64>.<iv b64>.<ct b64>.<tag b64>`.
 * DEK de 32B aleatória por chave; a DEK é cifrada pela mestra
 * (`iv12‖ct32‖tag16` concatenados no campo encDEK).
 * Mestra via arquivo `LICENSE_MASTER_KEY_PATH` (0600, 64 hex).
 * Sem master file, cai p/ o legado v1 com `LICENSE_KEY_ENC_KEY`
 * (compat dev). Sem segredo algum → null (reveal fica indisponível: 409).
 */
export function encryptLicenseKey(plaintext: string): string | null {
  const masters = masterKeys();
  if (masters.length > 0) return encryptEnvelope(plaintext, masters[0]);
  const legacy = legacyEnvKey();
  if (!legacy) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', legacy, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`;
}

function encryptEnvelope(plaintext: string, master: MasterKey): string {
  const dek = randomBytes(32);
  const ivDek = randomBytes(12);
  const cDek = createCipheriv('aes-256-gcm', master.key, ivDek);
  const encDek = Buffer.concat([
    ivDek,
    cDek.update(dek),
    cDek.final(),
    cDek.getAuthTag(),
  ]); // 12 + 32 + 16
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2.${master.ver}.${encDek.toString('base64')}.${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`;
}

/**
 * Decifra `key_enc`. `v2.*` → dual-decrypt (mestra atual, depois a
 * anterior de rotação); legado `v1.*` → env legado, depois mestras.
 * Erro (formato/auth) → throw (reveal nega, sem vazar motivo).
 */
export function decryptLicenseKey(payload: string): string {
  if (payload.startsWith('v2.')) return decryptEnvelope(payload);
  return decryptLegacy(payload);
}

function decryptEnvelope(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 6 || parts[0] !== 'v2') throw new Error('formato key_enc inválido');
  const masters = masterKeys();
  if (masters.length === 0) throw new Error('segredo de cifra ausente');
  const encDek = Buffer.from(parts[2], 'base64');
  if (encDek.length !== 12 + 32 + 16) throw new Error('formato key_enc inválido');
  const ivDek = encDek.subarray(0, 12);
  const ctDek = encDek.subarray(12, 44);
  const tagDek = encDek.subarray(44);
  const iv = Buffer.from(parts[3], 'base64');
  const ct = Buffer.from(parts[4], 'base64');
  const tag = Buffer.from(parts[5], 'base64');
  let lastErr: unknown = null;
  for (const m of masters) {
    try {
      const dDek = createDecipheriv('aes-256-gcm', m.key, ivDek);
      dDek.setAuthTag(tagDek);
      const dek = Buffer.concat([dDek.update(ctDek), dDek.final()]);
      if (dek.length !== 32) continue;
      const decipher = createDecipheriv('aes-256-gcm', dek, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error('formato key_enc inválido');
}

function decryptLegacy(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('formato key_enc inválido');
  const candidates: Buffer[] = [];
  const env = legacyEnvKey();
  if (env) candidates.push(env);
  for (const m of masterKeys()) candidates.push(m.key);
  if (candidates.length === 0) throw new Error('segredo de cifra ausente');
  let lastErr: unknown = null;
  for (const k of candidates) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(parts[1], 'base64'));
      decipher.setAuthTag(Buffer.from(parts[3], 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(parts[2], 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error('formato key_enc inválido');
}

/** Caminho default da mestra (versão `v1`, ver `masterVersion`). */
export const DEFAULT_MASTER_KEY_PATH = '/run/secrets/license-master-key';

export interface MasterKey {
  ver: string;
  key: Buffer;
}

/**
 * Versão da mestra p/ o envelope: `sha256(path)[:8]`; a mestra inicial
 * (caminho default) carrega `v1` — é essa etiqueta que a rotação conta
 * (`v2.v1.*` → re-cifrar; zerar a anterior quando o count chega a 0).
 */
export function masterVersion(path: string): string {
  if (!path || path === DEFAULT_MASTER_KEY_PATH) return 'v1';
  return createHash('sha256').update(path, 'utf8').digest('hex').slice(0, 8);
}

/**
 * Mestras válidas (atual + anterior de rotação). Arquivo precisa ser
 * regular, 0600 (sem bit p/ grupo/outros — checagem pulada no win32,
 * onde o FS não expressa modo POSIX) e conter 64 hex. Entrada
 * inválida = ignorada (fail-closed: encrypt cai p/ null, decrypt p/ throw).
 */
export function masterKeys(): MasterKey[] {
  const out: MasterKey[] = [];
  const cur = process.env.LICENSE_MASTER_KEY_PATH ?? '';
  if (cur) {
    const k = readMasterFile(cur);
    if (k) out.push({ ver: masterVersion(cur), key: k });
  }
  const prev = process.env.LICENSE_MASTER_KEY_PREVIOUS_PATH ?? '';
  if (prev && prev !== cur) {
    const k = readMasterFile(prev);
    if (k) out.push({ ver: masterVersion(prev), key: k });
  }
  return out;
}

function readMasterFile(path: string): Buffer | null {
  try {
    const st = statSync(path);
    if (!st.isFile()) return null;
    if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) return null;
    const raw = readFileSync(path, 'utf8').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
    return Buffer.from(raw, 'hex');
  } catch {
    return null;
  }
}

function legacyEnvKey(): Buffer | null {
  const raw = process.env.LICENSE_KEY_ENC_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}
