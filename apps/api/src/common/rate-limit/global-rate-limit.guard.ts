import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

// Rate-limit global por prefixo (Fase 6, aditivo).
// Presets espelhados 1:1 de `libs/security` `RATE_LIMITS` (apps/api compila
// com rootDir próprio — mesmo padrão de `auth/rate-limit.ts` e
// `licensing/reveal.guard.ts`; qualquer divergência deve ser alinhada lá):
// - login 5/min por IP+email | recovery 3/h por IP+email
// - webhook 100/min por IP | reveal 10/h por ator.
// - devicePoll 120/min por IP (polling do app instalado: validate + offline-token,
//   públicos no modo chave — sem JWT de usuário; a credencial é o device_hash).
// Este guard NÃO substitui os guards por rota (eles seguem existindo —
// dupla checagem com o mesmo limite não muda o comportamento observável:
// ambos 429 no mesmo teto). Ele fecha os gaps: webhooks sem guard dedicado
// + enforcement uniforme mesmo onde a rota não marcou `@RateLimit`.
// - Rotas `/health/*` nunca limitadas (probes K8s/CI).
// - Modo warn em teste: com `NODE_ENV=test` e sem identidade (sem IP nem
//   identificador/ator), só warn + allow — testes herméticos sem headers
//   nunca 429. Com identidade presente, enforcement normal (é o que o
//   spec `rate-limit-429` exercita).

export const GLOBAL_RATE_LIMITS = {
  login: { windowMs: 60_000, limit: 5, policy: 'login;w=60' },
  recovery: { windowMs: 3_600_000, limit: 3, policy: 'recovery;w=3600' },
  webhook: { windowMs: 60_000, limit: 100, policy: 'webhook;w=60' },
  licenseReveal: { windowMs: 3_600_000, limit: 10, policy: 'license-reveal;w=3600' },
  devicePoll: { windowMs: 60_000, limit: 120, policy: 'device-poll;w=60' },
  mfa: { windowMs: 300_000, limit: 5, policy: 'mfa;w=300' },
} as const;

export type GlobalRateLimitKey = keyof typeof GLOBAL_RATE_LIMITS;

class MemoryBucket {
  private static readonly MAX_KEYS = 10_000;
  private static readonly EVICT_CHUNK = 1_000;
  private hits = new Map<string, number[]>();
  take(key: string, windowMs: number, limit: number): { allowed: boolean; retryAfterMs: number } {
    const t = Date.now();
    // Evicção: chaves controladas pelo atacante não podem crescer sem limite.
    if (this.hits.size > MemoryBucket.MAX_KEYS) {
      let removed = 0;
      for (const k of this.hits.keys()) {
        this.hits.delete(k);
        if (++removed >= MemoryBucket.EVICT_CHUNK) break;
      }
    }
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

const bucket = new MemoryBucket();

/** Limpa buckets (testes). */
export function resetGlobalRateLimitBuckets(): void {
  bucket.reset();
}

const logger = new Logger('GlobalRateLimitGuard');

function clientIp(req: any): string {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length > 0) return String(fwd[0]).split(',')[0].trim();
  const ip = req.ip ?? req.socket?.remoteAddress ?? '';
  return typeof ip === 'string' && ip.length > 0 ? ip : 'unknown';
}

function bodyIdentifier(req: any): string {
  const b = req.body ?? {};
  for (const k of ['email', 'token', 'refreshToken', 'ticket']) {
    if (typeof b[k] === 'string' && b[k].length > 0) return String(b[k]).slice(0, 64).toLowerCase();
  }
  return '';
}

function actorOf(req: any): string {
  // Deriva o ator do JWT quando presente (req.user populado pela cadeia de
  // guards). Nunca confia em headers forjáveis (x-actor-id/x-subject-id/x-role).
  const u = req?.user;
  if (u && typeof u === 'object') {
    const sub = typeof u.sub === 'string' ? u.sub : (typeof u.id === 'string' ? u.id : '');
    if (sub.length > 0) return sub.slice(0, 128);
  }
  const ip = clientIp(req);
  return ip !== 'unknown' ? ip : '';
}

/** Prefixo → preset. null = fora do escopo (allow). */
export function matchRateLimitPreset(url: string): GlobalRateLimitKey | null {
  const u = String(url ?? '');
  if (u.startsWith('/health/') || u === '/health/live' || u === '/health/ready') return null;
  if (/\/v1\/auth\/(login|refresh)([/$?]|$)/.test(u)) return 'login';
  if (/\/v1\/auth\/(forgot|reset|resend-verification|verify-email)([/$?]|$)/.test(u)) return 'recovery';
  if (/\/v1\/auth\/mfa\//.test(u)) return 'mfa';
  if (/\/v1\/billing\/webhooks\//.test(u) || /\/webhooks\//.test(u)) return 'webhook';
  if (/\/reveal([/$?]|$)/.test(u)) return 'licenseReveal';
  if (/\/v1\/licenses\/activate-by-key([/$?]|$)/.test(u)) return 'licenseReveal';
  if (/\/v1\/licenses\/[^/]+\/validate([/$?]|$)/.test(u)) return 'devicePoll';
  if (/\/v1\/licenses\/[^/]+\/offline-token([/$?]|$)/.test(u)) return 'devicePoll';
  return null;
}

export function bucketKeyFor(preset: GlobalRateLimitKey, req: any): { key: string; identified: boolean } {
  const ip = clientIp(req);
  switch (preset) {
    case 'login':
    case 'recovery':
    case 'mfa': {
      const id = bodyIdentifier(req);
      return { key: `rl:${preset}:${ip}:${id}`, identified: ip !== 'unknown' || id.length > 0 };
    }
    case 'webhook':
    case 'devicePoll':
      return { key: `rl:${preset}:${ip}`, identified: ip !== 'unknown' };
    case 'licenseReveal': {
      const actor = actorOf(req);
      return { key: `rl:${preset}:${actor || 'unknown'}`, identified: actor.length > 0 };
    }
  }
}

@Injectable()
export class GlobalRateLimitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const url: string = req.url ?? req.originalUrl ?? '';
    const preset = matchRateLimitPreset(url);
    if (!preset) return true;
    const p = GLOBAL_RATE_LIMITS[preset];
    const { key, identified } = bucketKeyFor(preset, req);
    const res = context.switchToHttp().getResponse();
    try {
      res?.setHeader?.('RateLimit-Policy', p.policy);
    } catch {
      /* noop */
    }
    if (!identified && process.env.NODE_ENV === 'test') {
      logger.warn(`rate-limit warn (sem identidade em teste): preset=${preset} url=${url} — allow`);
      return true;
    }
    const r = bucket.take(key, p.windowMs, p.limit);
    if (!r.allowed) {
      try {
        res?.setHeader?.('Retry-After', String(Math.max(1, Math.ceil(r.retryAfterMs / 1000))));
      } catch {
        /* noop */
      }
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente mais tarde.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
