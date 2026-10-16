import { createHash, createHmac } from 'node:crypto';
import { computeDeviceHash as canonicalDeviceHash } from './device-hash.util';

// Helpers de device (Fase 3, PROJECT.md §4). Sem I/O.
//
// device_hash: fonte única em `device-hash.util.ts` (preimage contratual
// `${licenseId}.${appInstanceId}` — mudança quebra vínculos). Este arquivo
// adiciona só máscara IP, label stub e validação (sem duplicar o HMAC).

/** device_hash = HMAC(secret_rotativo, license_id || app_instance_id). Nunca hardware cru. */
export function computeDeviceHash(secret: string, licenseId: string, appInstanceId: string): string {
  return canonicalDeviceHash(secret, licenseId, appInstanceId);
}

/** Aceita só hash hex 64 (saída do HMAC-SHA256). */
export function isValidDeviceHash(v: string): boolean {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

/**
 * Normaliza IP p/ comparação/agrupamento de máquinas: trim, minúsculas,
 * remove zona (`%eth0`) e o prefixo IPv4-mapeado (`::ffff:1.2.3.4` → `1.2.3.4`).
 * Sem isso a mesma máquina ora aparece como `127.0.0.1`, ora como
 * `::ffff:127.0.0.1` (Node/docker) e o controle de máquinas distintas quebra.
 * Vazio/inválido → null.
 */
export function normalizeIp(ip: string | null | undefined): string | null {
  if (typeof ip !== 'string') return null;
  let v = ip.trim().toLowerCase();
  if (!v) return null;
  const pct = v.indexOf('%');
  if (pct >= 0) v = v.slice(0, pct);
  if (v.startsWith('::ffff:')) v = v.slice('::ffff:'.length);
  if (!v) return null;
  return v;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * ip_hash = HMAC(ip, salt rotativo 90d). Raw nunca persiste.
 * TODO(KMS): salt via KMS com rotação 90d; manter N-1 salts p/ verificação.
 */
export function hashIp(ip: string, salt: string): string {
  if (!salt) throw new Error('hashIp: salt vazio — forneça via env/KMS.');
  return createHmac('sha256', salt).update(ip, 'utf8').digest('hex');
}

/** ip_hint: IPv4 → /24 mascarado (`a.b.c.0/24`); IPv6 → /48 aproximado; inválido → null. */
export function maskIp24(ip: string | null | undefined): string | null {
  const v = normalizeIp(ip);
  if (!v) return null;
  const v4 = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((n) => n < 0 || n > 255)) return null;
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  if (v.includes(':')) {
    const head = v.split(':').slice(0, 3).join(':');
    return head ? `${head}::/48` : null;
  }
  return null;
}

/**
 * Cifra o rótulo do aparelho p/ `device_label_enc`.
 * STUB local (base64 com prefixo) — TODO(KMS): AES-256-GCM com DEK por licença.
 */
export function encryptLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  return `stub-b64$${Buffer.from(label, 'utf8').toString('base64')}`;
}

/** Decifra o stub acima (suporte). Falha fechada p/ formatos desconhecidos. */
export function decryptLabel(enc: string | null | undefined): string | null {
  if (!enc) return null;
  if (!enc.startsWith('stub-b64$')) throw new Error('decryptLabel: formato desconhecido (esperado stub KMS futuro).');
  return Buffer.from(enc.slice('stub-b64$'.length), 'base64').toString('utf8');
}

/** Fingerprint p/ logs (nunca o hash cheio): 12 primeiros chars. */
export function deviceHashFp(hash: string): string {
  return sha256Hex(hash).slice(0, 12);
}
