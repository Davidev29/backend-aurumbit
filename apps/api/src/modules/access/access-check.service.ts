import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { ACCESS_POOL } from './access-pool.provider';
import { CheckDecision, EntitlementCandidate, evaluateCheck } from './access-policy';
import { CheckAccessCacheService } from './check-access-cache.service';
import { CheckAccessQueryDto } from './dto';

export type CheckResult = CheckDecision & { cached: boolean };

// Leitura quente (alvo p99 <50ms, REQUIREMENTS.md §2): 1 SELECT por
// (owner, product, feature) + cache 60s. Batch limitado a 50 itens.
@Injectable()
export class AccessCheckService {
  constructor(
    @Inject(ACCESS_POOL) private readonly pool: Pool,
    private readonly cache: CheckAccessCacheService,
  ) {}

  async check(q: CheckAccessQueryDto, now = new Date()): Promise<CheckResult> {
    const channel = q.channel === 'WEB' || q.channel === 'DESKTOP' ? q.channel : undefined;
    const key = CheckAccessCacheService.key(q.ownerType, q.ownerId, q.productId, q.featureCode, channel);
    const hit = await this.cache.get(key);
    if (hit) {
      return { ...(JSON.parse(hit) as CheckDecision), cached: true };
    }
    const { rows } = await this.pool.query(
      `SELECT id, "ownerType", "ownerId", "productId", "featureCode", COALESCE(channel, 'BOTH') AS channel, origin,
              "originId", priority, status, "quotaValue", "startsAt", "expiresAt", "graceUntil"
       FROM entitlements
       WHERE "ownerType" = $1 AND "ownerId" = $2 AND "productId" = $3 AND "featureCode" = $4`,
      [q.ownerType, q.ownerId, q.productId, q.featureCode],
    );
    const decision = evaluateCheck(rows as EntitlementCandidate[], now, channel);
    await this.cache.set(key, JSON.stringify(decision));
    return { ...decision, cached: false };
  }

  async checkBatch(checks: CheckAccessQueryDto[], now = new Date()): Promise<CheckResult[]> {
    return Promise.all(checks.map((c) => this.check(c, now)));
  }
}
