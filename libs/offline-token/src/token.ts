// Offline JWT 7d — lib pura (Fase 3, PROJECT.md §1).
// Formato: iss/sub/owner/product/feat/dev/lic_exp/grace_until/off_exp/tv/iat(+iati alias)/jti.
// off_exp = min(iat + 7d, lic_exp + 7d). Vitalícia (lic_exp null) → off_exp = iat + 7d.
//
// Assinatura: stub HS256 local (HMAC-SHA256, segredo via env/KMS).
// TODO(KMS): migrar para ES256 com chave privada no KMS e `kid` apontando
// para a versão da chave; verificação passa a usar JWKS. O header já carrega
// `kid` para a transição ser backward-compatible.

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const OFFLINE_WINDOW_DAYS = 7;
export const OFFLINE_WINDOW_S = OFFLINE_WINDOW_DAYS * 24 * 3600;
// Tolerância de relógio p/ iat futuro antes de tratar como clone (5min).
export const FUTURE_IAT_SKEW_S = 300;

export type OfflineClaims = {
  iss: string;
  sub: string; // license id
  owner: string;
  product: string;
  feat: string[];
  dev: string; // device_hash
  lic_exp: number | null; // epoch s (null = vitalícia)
  grace_until: number | null; // epoch s
  off_exp: number; // epoch s
  tv: number; // token_version
  iat: number; // epoch s
  /** Alias legado de `iat` (alguns emissores usam `iati`). Leitura aceita ambos. */
  iati?: number;
  jti: string;
  /** Contador monotônico opcional (rollback/replay = clone). */
  ctr?: number;
};

export type MintInput = {
  iss: string;
  licenseId: string;
  ownerId: string;
  productId: string;
  features: string[];
  deviceHash: string;
  expiresAt: Date | null; // lic_exp (null = vitalícia)
  graceUntil: Date | null;
  tokenVersion: number;
  issuedAt?: Date;
  ctr?: number;
};

export type IssuedOfflineToken = {
  token: string;
  claims: OfflineClaims;
  kid: string;
};

/** off_exp = min(iat + 7d, lic_exp + 7d). Vitalícia → iat + 7d. */
export function computeOffExp(iatS: number, licExpS: number | null): number {
  const iatPlus = iatS + OFFLINE_WINDOW_S;
  if (licExpS === null || Number.isNaN(licExpS)) return iatPlus;
  return Math.min(iatPlus, licExpS + OFFLINE_WINDOW_S);
}

function toEpochS(d: Date | null): number | null {
  return d ? Math.floor(d.getTime() / 1000) : null;
}

function b64url(input: Buffer | string): string {
  const b = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function signHs256(signingInput: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(signingInput, 'utf8').digest());
}

/** Emite o offline JWT (stub HS256). Segredo via env/KMS, nunca hardcoded. */
export function mintOfflineToken(
  input: MintInput,
  secret: string,
  kid = 'local-hs256-1',
): IssuedOfflineToken {
  if (!secret) throw new Error('mintOfflineToken: segredo vazio — forneça via env/KMS.');
  const iat = Math.floor((input.issuedAt ?? new Date()).getTime() / 1000);
  const licExp = toEpochS(input.expiresAt);
  const claims: OfflineClaims = {
    iss: input.iss,
    sub: input.licenseId,
    owner: input.ownerId,
    product: input.productId,
    feat: input.features,
    dev: input.deviceHash,
    lic_exp: licExp,
    grace_until: toEpochS(input.graceUntil),
    off_exp: computeOffExp(iat, licExp),
    tv: input.tokenVersion,
    iat,
    iati: iat,
    jti: randomUUID(),
    ...(input.ctr !== undefined ? { ctr: input.ctr } : {}),
  };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid }));
  const body = b64url(JSON.stringify(claims));
  const sig = signHs256(`${header}.${body}`, secret);
  return { token: `${header}.${body}.${sig}`, claims, kid };
}

export type ValidateOptions = {
  secret: string;
  now?: Date;
  expectedIss?: string;
  /** token_version esperado (do registro online). Divergência = revogado/stale. */
  expectedTv?: number;
  /** device_hash esperado (amarração ao aparelho). */
  expectedDev?: string;
  /** Suspeita de clone já registrada no backend (marca DENY imediato). */
  clonedSuspect?: boolean;
  /** Status do device no backend. `blocked` nega; `rotated` fora da janela nega. */
  deviceStatus?: string;
  /** Contador máximo já visto p/ este device (rollback = clone). */
  lastCtr?: number | null;
};

export type OfflineVerdict =
  | { verdict: 'ALLOW'; degraded: false; reason: 'ACTIVE' | 'LIFETIME'; claims: OfflineClaims }
  | { verdict: 'ALLOW'; degraded: true; reason: 'GRACE'; claims: OfflineClaims }
  | {
      verdict: 'DENY';
      reason:
        | 'MALFORMED'
        | 'INVALID_SIGNATURE'
        | 'ISS_MISMATCH'
        | 'DEVICE_MISMATCH'
        | 'DEVICE_BLOCKED'
        | 'TOKEN_STALE'
        | 'CLONE_SUSPECT'
        | 'EXPIRED'
        | 'OFFLINE_EXPIRED';
      detail?: string;
    };

function fail(
  reason: OfflineVerdict extends never ? never : Extract<OfflineVerdict, { verdict: 'DENY' }>['reason'],
  detail?: string,
): OfflineVerdict {
  return { verdict: 'DENY', reason, detail } as OfflineVerdict;
}

/**
 * Validação pura do offline JWT (usada pelo app + testes).
 * Sem I/O: o backend resolve `expectedTv/expectedDev/clonedSuspect/deviceStatus/lastCtr`
 * a partir do registro online e injeta aqui.
 */
export function validateOfflineToken(token: string, opts: ValidateOptions): OfflineVerdict {
  const nowS = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const parts = token.split('.');
  if (parts.length !== 3) return fail('MALFORMED', 'jwt deve ter 3 segmentos');
  const [h, b, sig] = parts;
  let claims: OfflineClaims;
  try {
    claims = JSON.parse(b64urlDecode(b).toString('utf8')) as OfflineClaims;
  } catch {
    return fail('MALFORMED', 'payload não é JSON');
  }
  if (!opts.secret) return fail('INVALID_SIGNATURE', 'segredo ausente');
  const expected = signHs256(`${h}.${b}`, opts.secret);
  const a = Buffer.from(sig);
  const c = Buffer.from(expected);
  if (a.length !== c.length || !timingSafeEqual(a, c)) {
    return fail('INVALID_SIGNATURE');
  }
  if (opts.expectedIss !== undefined && claims.iss !== opts.expectedIss) {
    return fail('ISS_MISMATCH', `iss ${claims.iss} != ${opts.expectedIss}`);
  }
  if (opts.expectedDev !== undefined && claims.dev !== opts.expectedDev) {
    return fail('DEVICE_MISMATCH', 'token amarrado a outro device');
  }
  if (opts.deviceStatus === 'blocked') return fail('DEVICE_BLOCKED', 'device bloqueado no backend');
  if (opts.clonedSuspect) return fail('CLONE_SUSPECT', 'device marcado como clone suspeito');
  if (opts.expectedTv !== undefined && claims.tv !== opts.expectedTv) {
    return fail('TOKEN_STALE', `tv ${claims.tv} != ${opts.expectedTv} (revogado?)`);
  }
  const iat = claims.iati ?? claims.iat;
  if (typeof iat === 'number' && iat - nowS > FUTURE_IAT_SKEW_S) {
    return fail('CLONE_SUSPECT', 'iat no futuro além da tolerância');
  }
  if (
    typeof claims.ctr === 'number' &&
    typeof opts.lastCtr === 'number' &&
    claims.ctr < opts.lastCtr
  ) {
    return fail('CLONE_SUSPECT', `ctr ${claims.ctr} < last ${opts.lastCtr} (rollback/replay)`);
  }
  if (claims.off_exp === undefined || claims.off_exp === null) {
    return fail('MALFORMED', 'off_exp ausente');
  }

  const licExp = claims.lic_exp;
  const grace = claims.grace_until;

  // Vitalícia: só o teto offline limita.
  if (licExp === null || licExp === undefined) {
    if (nowS > claims.off_exp) return fail('OFFLINE_EXPIRED', 'teto 7d offline excedido');
    return { verdict: 'ALLOW', degraded: false, reason: 'LIFETIME', claims };
  }
  if (nowS <= licExp && nowS <= claims.off_exp) {
    return { verdict: 'ALLOW', degraded: false, reason: 'ACTIVE', claims };
  }
  // Após a graça: EXPIRED mesmo com off_exp válido (PROJECT.md §1).
  if (grace !== null && grace !== undefined && nowS > grace) {
    return fail('EXPIRED', 'além de grace_until');
  }
  if (grace === null || grace === undefined) {
    if (nowS > licExp) return fail('EXPIRED', 'licença expirada sem graça');
  }
  // Dentro da graça mas teto offline estourou → exige online.
  if (nowS > claims.off_exp) return fail('OFFLINE_EXPIRED', 'teto 7d offline excedido');
  if (nowS > licExp) {
    return { verdict: 'ALLOW', degraded: true, reason: 'GRACE', claims };
  }
  // now <= off_exp falhou acima só se now > lic_exp; resta: lic vigente mas off estourou.
  return fail('OFFLINE_EXPIRED', 'teto 7d offline excedido');
}
