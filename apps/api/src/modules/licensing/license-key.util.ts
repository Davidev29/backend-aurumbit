import { createDecipheriv, createCipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

// Util de chaves de licença (PROJECT.md §2).
// Autocontido em apps/api (nest build tem rootDir=apps/api, então não
// importa libs/* por caminho relativo): semântica espelhada de
// libs/security maskLicenseKey/sha256Hex. Divergência intencional = bug.
const BULLET = '•';
// Sem I,L,O,0,1 para evitar confusão no suporte.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const KEY_RE = /^AURUM-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

/** Gera `AURUM-XXXX-XXXX-XXXX` a partir de seed CSPRNG 128-bit. Unicidade final via `key_hash` UNIQUE + retry. */
export function generateLicenseKey(): string {
  const seed = randomBytes(16);
  const pick = (b: number): string => ALPHABET[b % ALPHABET.length];
  const g = (off: number): string =>
    [0, 1, 2, 3].map((i) => pick(seed[off + i] ?? 0)).join('');
  // Último grupo dobra os bytes 12..15 para usar toda a entropia do seed.
  const last = [0, 1, 2, 3]
    .map((i) => pick((seed[8 + i] ?? 0) ^ (seed[12 + i] ?? 0)))
    .join('');
  return `AURUM-${g(0)}-${g(4)}-${last}`;
}

export function isLicenseKeyFormat(key: string): boolean {
  return KEY_RE.test(key);
}

/** Prefixo de suporte: primeiro grupo (4 chars). */
export function keyPrefixOf(key: string): string {
  return key.split('-')[1] ?? '';
}

/** Sufixo de suporte: último grupo (4 chars). */
export function keyLast4Of(key: string): string {
  return key.slice(-4);
}

/** `AURUM-XXXX-XXXX-AB12` → `AURUM-••••-••••-AB12`. Fora do padrão vira máscara total. */
export function maskKey(key: string): string {
  if (!isLicenseKeyFormat(key)) return '••••';
  return `AURUM-${BULLET.repeat(4)}-${BULLET.repeat(4)}-${keyLast4Of(key)}`;
}

/** SHA-256 hex — APENAS p/ índice `key_hash` UNIQUE. Nunca p/ senha. */
export function sha256HexKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

function keyEncKey(): Buffer {
  const secret = process.env.LICENSING_KEY_ENC_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('LICENSING_KEY_ENC_SECRET ausente em produção (fail-fast).');
    }
    return scryptSync('test-only-keyenc-secret', 'aurum-lic-keyenc', 32);
  }
  return scryptSync(secret, 'aurum-lic-keyenc', 32);
}

/**
 * Cifra a chave p/ `key_enc` (AES-256-GCM, reemissão auditada).
 * Fase 3 usa segredo de env; TODO(Fase 4): KMS com envelope + rotação.
 */
export function encryptLicenseKey(key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyEncKey(), iv);
  const enc = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

/** Decifra `key_enc`. Falha fechada (lança) se secret/IV/tag divergirem. */
export function decryptLicenseKey(keyEnc: string): string {
  const [ivB64, tagB64, encB64] = keyEnc.split('.');
  if (!ivB64 || !tagB64 || !encB64) throw new Error('key_enc malformado');
  const decipher = createDecipheriv('aes-256-gcm', keyEncKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
