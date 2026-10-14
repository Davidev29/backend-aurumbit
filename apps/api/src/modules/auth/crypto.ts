import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';

function scryptKey(plain: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    (scryptCb as any)(plain, salt, keylen, opts, (err: unknown, dk: unknown) =>
      err ? reject(err) : resolve(dk as Buffer),
    );
  });
}

// ---------------------------------------------------------------------------
// Hash genérico (NUNCA p/ senha) + tokens opacos.
// ---------------------------------------------------------------------------

/** SHA-256 hex — p/ token_hash de refresh/recovery/verify (busca UNIQUE). NUNCA p/ senha. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function safeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Token opaco: 32 bytes (256-bit) por padrão, hex. */
export function randomTokenHex(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function newId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Normalização de e-mail / máscara (espelha libs/security maskEmail).
// norm = busca UNIQUE + anti-enumeração; display = exibição.
// ---------------------------------------------------------------------------

export function normalizeEmail(raw: string): { norm: string; display: string } {
  const display = raw.trim();
  return { norm: display.toLowerCase(), display };
}

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const user = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${user[0]}***@${domain}`;
}

// ---------------------------------------------------------------------------
// Senha: Argon2id preferencial, scrypt fallback (sem nova dep nativa).
// Formatos: PHC argon2 ($argon2id$...) ou $scrypt$N$r$p$saltB64$hashB64.
// ---------------------------------------------------------------------------

function loadArgon2(): any | null {
  try {
    // optionalDependency: presente em prod, ausente no skeleton/build local.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('argon2');
  } catch {
    return null;
  }
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

async function scryptHash(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scryptKey(plain, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `$scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

async function scryptVerify(stored: string, plain: string): Promise<boolean> {
  const parts = stored.split('$');
  // ['', 'scrypt', N, r, p, saltB64, hashB64]
  if (parts.length !== 7 || parts[1] !== 'scrypt') return false;
  const N = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  const salt = Buffer.from(parts[5], 'base64');
  const expected = Buffer.from(parts[6], 'base64');
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || salt.length === 0) return false;
  try {
    const dk = await scryptKey(plain, salt, expected.length, { N, r, p });
    if (dk.length !== expected.length) return false;
    return timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}

export function passwordHasherInfo(): { argon2: boolean; fallback: 'scrypt' | null } {
  const a = loadArgon2();
  return { argon2: !!a, fallback: a ? null : 'scrypt' };
}

export async function hashPassword(plain: string): Promise<string> {
  const argon2 = loadArgon2();
  if (argon2) return argon2.hash(plain, { type: argon2.argon2id });
  return scryptHash(plain); // fallback sem dep nativa; prefixo identifica o algoritmo
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  if (stored.startsWith('$argon2')) {
    const argon2 = loadArgon2();
    if (!argon2) throw new Error('argon2 indisponível p/ verificar hash argon2 — instale a optionalDependency.');
    try {
      return await argon2.verify(stored, plain);
    } catch {
      return false;
    }
  }
  if (stored.startsWith('$scrypt$')) return scryptVerify(stored, plain);
  // Formato desconhecido/legado rápido: nunca aceitar silenciosamente.
  throw new Error('Formato de password_hash desconhecido — recuse e force reset.');
}

export function validatePasswordPolicy(plain: string, emailNorm?: string): string[] {
  const codes: string[] = [];
  if (typeof plain !== 'string' || plain.length < 8) codes.push('PASSWORD_TOO_SHORT');
  if (plain && plain.length > 128) codes.push('PASSWORD_TOO_LONG');
  if (emailNorm && plain && plain.toLowerCase().includes(emailNorm.split('@')[0]) && emailNorm.split('@')[0].length >= 4) {
    codes.push('PASSWORD_CONTAINS_EMAIL');
  }
  return codes;
}

// ---------------------------------------------------------------------------
// Base32 (RFC 4648, sem deps) — p/ segredo TOTP/MFA.
// ---------------------------------------------------------------------------

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const byte of buf) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32_ALPHABET[(acc >>> bits) & 31];
    }
  }
  if (bits > 0) out += B32_ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.trim().replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let acc = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const v = B32_ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('BASE32_INVALID');
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// TOTP RFC 6238 (SHA-1, passo 30s, 6 dígitos) — enroll/verify sem deps.
// ---------------------------------------------------------------------------

export function totpCode(secretB32: string, atMs = Date.now(), stepSec = 30, digits = 6): string {
  const key = base32Decode(secretB32);
  const counter = Math.floor(atMs / 1000 / stepSec);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

export function verifyTotp(secretB32: string, code: string, atMs = Date.now(), window = 1): boolean {
  const c = code.trim();
  if (!/^\d{6}$/.test(c)) return false;
  for (let w = -window; w <= window; w++) {
    const t = totpCode(secretB32, atMs + w * 30_000);
    const a = Buffer.from(t);
    const b = Buffer.from(c);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function newMfaSecret(): string {
  return base32Encode(randomBytes(20)); // 160 bits, como RFC 4226
}

export function mfaOtpauthUrl(secretB32: string, account: string, issuer = 'Aurum Bit'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

// ---------------------------------------------------------------------------
// JWT HS256 manual (access 15min + ticket MFA 5min).
// TODO(KMS): RS256 com chaves em KMS/HSM; HS256 local aceito só como stub.
// Segredo via env JWT_SECRET (ou AUTH_JWT_SECRET); sem fallback silencioso em prod.
// ---------------------------------------------------------------------------

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf as any)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export interface AccessClaims {
  sub: string; // identity id
  sid: string; // session id
  fid: string; // family id
  mfa: boolean; // MFA satisfeito nesta sessão?
  jti: string; // id único do token (exigido pela cadeia global common/guards)
  iss: string;
  aud: string;
  iat: number; // epoch sec
  exp: number; // epoch sec
}

export interface MfaTicketClaims {
  scope: 'mfa';
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  if (!secret) throw new Error('JWT_SECRET ausente — configure via env/KMS.');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64url(sig)}`;
}

function verifyJwt<T>(token: string, secret: string): T {
  if (!secret) throw new Error('JWT_SECRET ausente — configure via env/KMS.');
  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('JWT_MALFORMED'), { code: 'JWT_MALFORMED' });
  const [h, b, s] = parts;
  const expected = createHmac('sha256', secret).update(`${h}.${b}`).digest();
  const got = b64urlDecode(s);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw Object.assign(new Error('JWT_BAD_SIGNATURE'), { code: 'JWT_BAD_SIGNATURE' });
  }
  return JSON.parse(b64urlDecode(b).toString('utf8')) as T;
}

export function signAccessToken(
  c: { sub: string; sid: string; fid: string; mfa: boolean; email_verified?: boolean },
  secret: string,
  opts: { issuer: string; audience: string; ttlSec?: number; nowMs?: number },
): string {
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const ttl = opts.ttlSec ?? 900; // 15min
  return signJwt(
    {
      ...c,
      email_verified: c.email_verified ?? false,
      jti: randomUUID(),
      iss: opts.issuer,
      aud: opts.audience,
      iat: now,
      exp: now + ttl,
    },
    secret,
  );
}

export function verifyAccessToken(
  token: string,
  secret: string,
  opts: { issuer: string; audience: string; nowMs?: number },
): AccessClaims {
  const p = verifyJwt<AccessClaims>(token, secret);
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (p.exp <= now) throw Object.assign(new Error('JWT_EXPIRED'), { code: 'JWT_EXPIRED' });
  if (p.iss !== opts.issuer || p.aud !== opts.audience) throw Object.assign(new Error('JWT_AUDIENCE'), { code: 'JWT_AUDIENCE' });
  if (!p.sub || !p.sid || !p.fid) throw Object.assign(new Error('JWT_CLAIMS'), { code: 'JWT_CLAIMS' });
  return p;
}

export function signMfaTicket(sub: string, secret: string, opts: { issuer: string; audience: string; nowMs?: number }): string {
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  return signJwt({ scope: 'mfa', sub, iss: opts.issuer, aud: opts.audience, iat: now, exp: now + 300 }, secret);
}

export function verifyMfaTicket(
  ticket: string,
  secret: string,
  opts: { issuer: string; audience: string; nowMs?: number },
): MfaTicketClaims {
  const p = verifyJwt<MfaTicketClaims>(ticket, secret);
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (p.scope !== 'mfa') throw Object.assign(new Error('JWT_SCOPE'), { code: 'JWT_SCOPE' });
  if (p.exp <= now) throw Object.assign(new Error('JWT_EXPIRED'), { code: 'JWT_EXPIRED' });
  if (p.iss !== opts.issuer || p.aud !== opts.audience) throw Object.assign(new Error('JWT_AUDIENCE'), { code: 'JWT_AUDIENCE' });
  return p;
}

// ---------------------------------------------------------------------------
// AES-256-GCM p/ segredo MFA em repouso (TODO KMS: envelope encryption).
// ---------------------------------------------------------------------------

export function deriveEncKey(...parts: string[]): Buffer {
  return createHash('sha256').update(parts.join('|'), 'utf8').digest();
}

export function encryptSecret(plainB32: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plainB32, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`;
}

export function decryptSecret(enc: string, key: Buffer): string {
  const parts = enc.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('MFA_SECRET_VERSION');
  const iv = Buffer.from(parts[1], 'base64');
  const ct = Buffer.from(parts[2], 'base64');
  const tag = Buffer.from(parts[3], 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
