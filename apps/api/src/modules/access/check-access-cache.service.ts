import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

// Cache do check-access (TTL 60s). Redis é acelerador, NUNCA fonte definitiva
// (PROJECT.md: decisão vinculante). Sem Redis alcançável → fallback em memória
// por processo (melhor esforço; invalidação por TTL em ambos os casos).
// TODO(Fase 4/Eventos): invalidar por chave no provisionamento/revogação
// (outbox access.* → relay), em vez de depender só do TTL.
@Injectable()
export class CheckAccessCacheService implements OnModuleDestroy {
  private readonly log = new Logger(CheckAccessCacheService.name);
  private readonly ttlSec = 60;
  private redis: Redis | null = null;
  private redisCooldownUntil = 0;
  private readonly memory = new Map<string, { value: string; exp: number }>();

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.log.warn('REDIS_URL ausente — check-access usará só fallback em memória');
      return;
    }
    this.redis = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });
    this.redis.on('error', (err: Error) => {
      this.log.warn(`redis indisponível p/ check-access, usando memória: ${err.message}`);
    });
  }

  // Fase 8: channel na chave — sem isso, um ALLOW cacheado no canal
  // DESKTOP vazaria para o canal WEB (e vice-versa). Omitido = legado v1.
  static key(
    ownerType: string,
    ownerId: string,
    productId: string,
    featureCode: string,
    channel?: string,
  ): string {
    const ch = channel ?? 'ANY';
    return `access:check:v1:${ownerType}:${ownerId}:${productId}:${featureCode}:${ch}`;
  }

  private async redisClient(): Promise<Redis | null> {
    if (!this.redis || Date.now() < this.redisCooldownUntil) return null;
    try {
      if (this.redis.status !== 'ready') await this.redis.connect();
      return this.redis;
    } catch {
      // Cooldown 5s para não martelar um Redis fora do ar no hot path.
      this.redisCooldownUntil = Date.now() + 5_000;
      return null;
    }
  }

  async get(key: string): Promise<string | null> {
    const client = await this.redisClient();
    if (client) {
      try {
        return await client.get(key);
      } catch {
        this.redisCooldownUntil = Date.now() + 5_000;
      }
    }
    const hit = this.memory.get(key);
    if (!hit) return null;
    if (Date.now() > hit.exp) {
      this.memory.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string): Promise<void> {
    const client = await this.redisClient();
    if (client) {
      try {
        await client.setex(key, this.ttlSec, value);
        return;
      } catch {
        this.redisCooldownUntil = Date.now() + 5_000;
      }
    }
    this.memory.set(key, { value, exp: Date.now() + this.ttlSec * 1000 });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.redis?.disconnect();
    } catch {
      // ignore — teardown best-effort
    }
  }
}
