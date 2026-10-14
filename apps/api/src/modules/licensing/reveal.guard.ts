import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

// Rate-limit do reveal (PROJECT.md §2: 10/h). Valores copiados 1:1 de
// libs/security RATE_LIMITS.licenseReveal (apps/api não importa o pacote
// — mesmo padrão de `auth/rate-limit.ts`). Chave por ator (nunca só IP).
// Produção usa Redis; aqui token-bucket em memória com a mesma semântica.

const WINDOW_MS = 3_600_000;
const LIMIT = 10;
const POLICY = 'license-reveal;w=3600';

class MemoryBucket {
  private hits = new Map<string, number[]>();
  take(key: string): { allowed: boolean; retryAfterMs: number } {
    const t = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((ts) => ts > t - WINDOW_MS);
    if (arr.length >= LIMIT) {
      const retryAfterMs = arr[0] + WINDOW_MS - t;
      this.hits.set(key, arr);
      return { allowed: false, retryAfterMs };
    }
    arr.push(t);
    this.hits.set(key, arr);
    return { allowed: true, retryAfterMs: 0 };
  }
}

const bucket = new MemoryBucket();

function actorOf(req: any): string {
  const h = req.headers ?? {};
  for (const k of ['x-actor-id', 'x-subject-id']) {
    const v = h[k];
    if (typeof v === 'string' && v.length > 0) return v.slice(0, 128);
  }
  if (typeof h['x-role'] === 'string' && h['x-role'].length > 0) {
    return `role:${h['x-role']}`;
  }
  const fwd = h['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim().slice(0, 64);
  return String(req.ip ?? req.socket?.remoteAddress ?? 'unknown').slice(0, 64);
}

@Injectable()
export class RevealRateLimitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const key = `rl:licenseReveal:${actorOf(req)}`;
    const r = bucket.take(key);
    try {
      context.switchToHttp().getResponse()?.setHeader?.('RateLimit-Policy', POLICY);
    } catch {
      /* noop */
    }
    if (!r.allowed) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Limite de revelação de chave excedido (10/h).' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
