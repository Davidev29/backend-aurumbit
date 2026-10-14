import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// Presets espelhados de libs/security RATE_LIMITS (Fase 1). Não importamos o
// pacote aqui porque apps/api compila com rootDir próprio (tsconfig) — os
// valores são copiados 1:1 e qualquer divergência deve ser alinhada lá.
// - login 5/min por IP+email | recovery 3/h por IP+email | mfa 5/5min
export const AUTH_RATE_LIMITS = {
  login: { windowMs: 60_000, limit: 5, policy: 'login;w=60' },
  recovery: { windowMs: 3_600_000, limit: 3, policy: 'recovery;w=3600' },
  webhook: { windowMs: 60_000, limit: 100, policy: 'webhook;w=60' },
  licenseReveal: { windowMs: 3_600_000, limit: 10, policy: 'license-reveal;w=3600' },
  mfa: { windowMs: 300_000, limit: 5, policy: 'mfa;w=300' },
  register: { windowMs: 60_000, limit: 10, policy: 'auth-register;w=60' },
  verify: { windowMs: 300_000, limit: 10, policy: 'auth-verify;w=300' },
} as const;

export type AuthRateLimitKey = keyof typeof AUTH_RATE_LIMITS;

export const RATE_LIMIT_META = 'auth:rate-limit';

/** @RateLimit('login') — aplica o preset ao endpoint. Chave = IP + identificador (nunca só IP). */
export const RateLimit = (preset: AuthRateLimitKey) => SetMetadata(RATE_LIMIT_META, preset);

/** Token-bucket em memória (mesma semântica de libs/security MemoryBucket). Produção usa Redis. */
export class MemoryBucket {
  private hits = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}
  take(key: string, windowMs: number, limit: number): { allowed: boolean; retryAfterMs: number } {
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((ts) => ts > t - windowMs);
    if (arr.length >= limit) {
      const retryAfterMs = arr[0] + windowMs - t;
      this.hits.set(key, arr);
      return { allowed: false, retryAfterMs };
    }
    arr.push(t);
    this.hits.set(key, arr);
    return { allowed: true, retryAfterMs: 0 };
  }
  reset(key?: string): void {
    if (key) this.hits.delete(key);
    else this.hits.clear();
  }
}

const buckets = new MemoryBucket();

function clientIp(req: any): string {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

function identifier(req: any): string {
  const b = req.body ?? {};
  for (const k of ['email', 'token', 'refreshToken', 'ticket']) {
    if (typeof b[k] === 'string' && b[k].length > 0) return `:${String(b[k]).slice(0, 64).toLowerCase()}`;
  }
  return '';
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const preset = this.reflector.getAllAndOverride<AuthRateLimitKey | undefined>(RATE_LIMIT_META, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!preset) return true;
    const p = AUTH_RATE_LIMITS[preset];
    const req = context.switchToHttp().getRequest();
    const key = `rl:${preset}:${clientIp(req)}${identifier(req)}`;
    const r = buckets.take(key, p.windowMs, p.limit);
    const res = context.switchToHttp().getResponse();
    try {
      res?.setHeader?.('RateLimit-Policy', p.policy);
    } catch {
      /* noop */
    }
    if (!r.allowed) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente mais tarde.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
