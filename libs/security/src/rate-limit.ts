/**
 * Rate-limit configs — Fase 1, sem negócio (stubs p/ T2 plugar no Nest).
 * Valores alinhados a PROJECT §§1-2 e REQUIREMENTS §1:
 * - login 5/min por IP+email (anti-enumeração/brute-force, com lockout na Fase 2)
 * - recovery 3/h por IP+email | webhook Asaas 100/min por IP | reveal 10/h por ator
 * - devicePoll 120/min por IP (polling do app instalado: validate + offline-token,
 *   públicos no modo chave — ver global-rate-limit.guard `devicePoll`)
 * Exporta presets agnósticos (p/ `@nestjs/throttler` ou `express-rate-limit`)
 * + um token-bucket em memória p/ workers/scripts Fase 1 sem Redis.
 */

export interface RateLimitPreset {
  /** Janela em ms. */
  windowMs: number;
  /** Máximo de tentativas por janela por chave. */
  limit: number;
  /** Nome p/ header `RateLimit-Policy` / métricas. */
  policy: string;
  message?: string;
}

export const RATE_LIMITS = {
  login: { windowMs: 60_000, limit: 5, policy: "login;w=60", message: "Muitas tentativas. Tente em 1 minuto." },
  recovery: { windowMs: 3_600_000, limit: 3, policy: "recovery;w=3600", message: "Limite de recuperação excedido. Tente mais tarde." },
  webhook: { windowMs: 60_000, limit: 100, policy: "webhook;w=60" },
  licenseReveal: { windowMs: 3_600_000, limit: 10, policy: "license-reveal;w=3600", message: "Limite de revelação de chave excedido." },
  devicePoll: { windowMs: 60_000, limit: 120, policy: "device-poll;w=60", message: "Muitas validações. Tente em 1 minuto." },
  mfa: { windowMs: 300_000, limit: 5, policy: "mfa;w=300" },
  apiDefault: { windowMs: 60_000, limit: 120, policy: "api;w=60" },
} as const satisfies Record<string, RateLimitPreset>;

export type RateLimitKey = keyof typeof RATE_LIMITS;

/** Monta chave de bucket. Login/recovery sempre compõem IP+identificador (nunca só IP). */
export function bucketKey(preset: RateLimitKey, ...parts: string[]): string {
  return `rl:${preset}:${parts.join(":")}`;
}

/** Opções prontas p/ `express-rate-limit` (T2 adapta ao Nest). */
export function toExpressOptions(preset: RateLimitKey) {
  const p: RateLimitPreset = RATE_LIMITS[preset];
  return { windowMs: p.windowMs, max: p.limit, standardHeaders: true, legacyHeaders: false, message: p.message ?? "Too many requests." };
}

/** Limites p/ `@nestjs/throttler` (name/ttl/limit). ttl em segundos. */
export function toThrottler(name: RateLimitKey) {
  const p = RATE_LIMITS[name];
  return { name, ttl: Math.floor(p.windowMs / 1000), limit: p.limit };
}

/** Token-bucket em memória (Fase 1: smoke/workers sem Redis). Produção usa Redis (Fase 6). */
export class MemoryBucket {
  private hits = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}

  take(key: string, preset: RateLimitPreset): { allowed: boolean; retryAfterMs: number } {
    const t = this.now();
    const windowStart = t - preset.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((ts) => ts > windowStart);
    if (arr.length >= preset.limit) {
      const retryAfterMs = arr[0] + preset.windowMs - t;
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
