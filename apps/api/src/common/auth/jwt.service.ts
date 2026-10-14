import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtPayload } from './jwt-payload';

/**
 * JWT HS256 mínimo (sem dependência externa) p/ a cadeia `common/guards`.
 * Valida: assinatura, `iss`, `aud`, `exp` (+`nbf`/`iat` quando presentes),
 * presença de `sub`/`sid`/`jti`.
 *
 * Config via env (validadas fail-fast em `config/env.schema.ts`):
 * - `JWT_SECRET` (≥16 chars; default de teste recusado em produção)
 * - `JWT_ISS` (default `aurum-bit`), `JWT_AUD` (default `aurum-clients`)
 *
 * LGPD: o payload nunca carrega PII além de identificadores opacos
 * (`sub`/`sid`); e-mail/senha/CPF são proibidos aqui.
 */

export const JWT_TEST_DEFAULT_SECRET = 'test-only-secret-min-16-chars';
const CLOCK_SKEW_SEC = 30;

export interface JwtOptions {
  secret: string;
  issuer: string;
  audience: string;
}

export function resolveJwtOptions(): JwtOptions {
  const secret = process.env.JWT_SECRET ?? JWT_TEST_DEFAULT_SECRET;
  if (process.env.NODE_ENV === 'production' && secret === JWT_TEST_DEFAULT_SECRET) {
    throw new Error('JWT_SECRET padrão de teste recusado em produção (fail-fast).');
  }
  return {
    secret,
    issuer: process.env.JWT_ISS ?? 'aurum-bit',
    audience: process.env.JWT_AUD ?? 'aurum-clients',
  };
}

/** Erro de verificação com `code` estável (mapeado p/ 401 pelo guard). */
export class JwtError extends Error {
  constructor(
    public readonly code:
      | 'TOKEN_MISSING'
      | 'TOKEN_MALFORMED'
      | 'TOKEN_SIGNATURE'
      | 'TOKEN_EXPIRED'
      | 'TOKEN_NOT_YET_VALID'
      | 'TOKEN_ISSUER'
      | 'TOKEN_AUDIENCE'
      | 'TOKEN_CLAIMS',
    message: string,
  ) {
    super(message);
    this.name = 'JwtError';
  }
}

function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

function signHs256(unsigned: string, secret: string): string {
  return b64urlEncode(createHmac('sha256', secret).update(unsigned, 'utf8').digest());
}

export interface SignInput {
  sub: string;
  sid: string;
  amr?: string[];
  email_verified?: boolean;
  roles?: string[];
  token_version?: number;
  /** Segundos de vida (default 900 = 15min, cf. `.env.example` JWT_TTL). */
  expiresInSec?: number;
  /** `iat` override (testes de expiração). */
  issuedAtSec?: number;
}

@Injectable()
export class JwtService {
  private readonly opts = resolveJwtOptions();

  sign(input: SignInput): string {
    const now = input.issuedAtSec ?? Math.floor(Date.now() / 1000);
    const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload: JwtPayload = {
      sub: input.sub,
      sid: input.sid,
      jti: randomUUID(),
      iss: this.opts.issuer,
      aud: this.opts.audience,
      iat: now,
      exp: now + (input.expiresInSec ?? 900),
      amr: input.amr ?? ['pwd'],
      email_verified: input.email_verified ?? false,
      roles: input.roles ?? [],
      token_version: input.token_version ?? 0,
    };
    const body = b64urlEncode(JSON.stringify(payload));
    const unsigned = `${header}.${body}`;
    return `${unsigned}.${signHs256(unsigned, this.opts.secret)}`;
  }

  verify(token: string): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new JwtError('TOKEN_MALFORMED', 'JWT malformado.');
    const [headerB64, bodyB64, sig] = parts;
    let header: unknown;
    let payload: Record<string, unknown>;
    try {
      header = JSON.parse(b64urlDecode(headerB64).toString('utf8')) as unknown;
      payload = JSON.parse(b64urlDecode(bodyB64).toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new JwtError('TOKEN_MALFORMED', 'JWT com JSON inválido.');
    }
    if (typeof header !== 'object' || header === null || (header as { alg?: unknown }).alg !== 'HS256') {
      throw new JwtError('TOKEN_MALFORMED', 'Algoritmo JWT não suportado (esperado HS256).');
    }
    const expected = signHs256(`${headerB64}.${bodyB64}`, this.opts.secret);
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new JwtError('TOKEN_SIGNATURE', 'Assinatura JWT inválida.');
    }
    return this.assertClaims(payload);
  }

  private assertClaims(p: Record<string, unknown>): JwtPayload {
    const now = Math.floor(Date.now() / 1000);
    const { sub, sid, jti, iss, aud, iat, exp, nbf } = p;
    if (typeof sub !== 'string' || !sub || typeof sid !== 'string' || !sid || typeof jti !== 'string' || !jti) {
      throw new JwtError('TOKEN_CLAIMS', 'Claims obrigatórias ausentes (sub/sid/jti).');
    }
    if (iss !== this.opts.issuer) throw new JwtError('TOKEN_ISSUER', 'Issuer (iss) inesperado.');
    const audiences = Array.isArray(aud) ? aud : [aud];
    if (!audiences.includes(this.opts.audience)) {
      throw new JwtError('TOKEN_AUDIENCE', 'Audience (aud) inesperada.');
    }
    if (typeof exp !== 'number' || now >= exp + CLOCK_SKEW_SEC) {
      throw new JwtError('TOKEN_EXPIRED', 'Token expirado.');
    }
    if (typeof nbf === 'number' && now + CLOCK_SKEW_SEC < nbf) {
      throw new JwtError('TOKEN_NOT_YET_VALID', 'Token ainda não válido (nbf).');
    }
    if (typeof iat === 'number' && iat > now + CLOCK_SKEW_SEC) {
      throw new JwtError('TOKEN_NOT_YET_VALID', 'Token com iat no futuro.');
    }
    return p as unknown as JwtPayload;
  }
}
