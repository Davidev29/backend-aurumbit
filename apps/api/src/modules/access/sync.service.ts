// Sync Licensing → Access (Fase 3). Consumidor idempotente de `licensing.*.v1`.
// - Dedupe primeiro: INSERT no outbox com eventId=envelope.eventId
//   `ON CONFLICT DO NOTHING` (PROJECT.md §5). Replay → { duplicate: true },
//   sem reescrever entitlement nem reemitir.
// - Upsert de Entitlement origin=LICENSE/priority 30 via UNIQUE 6-col; o
//   `DO UPDATE` nunca regride REVOKED (fora de ordem não reativa terminal).
// - Invalida cache `access:{owner}:{product}:{feature}` (+ chave canônica).
// - `executeCascade` aplica o plano puro de planRevocationCascade no lado
//   access; o lado licensing roda via `withLicensingDb` (opcional) com bump
//   de token_version protegido por probe (stub Fase 1 não tem a coluna).
// Não reescreve controllers; não altera schemas Prisma.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { ACCESS_POOL } from './access-pool.provider';
import { accessCacheKeys } from './evaluator.transitions';
import {
  CascadeInput,
  LicenseEntitlementUpsert,
  entitlementUpsertsFor,
  featureCodesFor,
  parseLicenseEnvelope,
  planRevocationCascade,
} from './sync.transitions';

export interface SqlRunner {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }>;
}

export interface CacheInvalidator {
  invalidate(keys: string[]): Promise<number>;
}

/** DEL best-effort no Redis; sem REDIS_URL vira no-op (nunca fonte definitiva). */
export class RedisCacheInvalidator implements CacheInvalidator {
  private redis: Redis | null = null;
  private cooldownUntil = 0;

  private client(): Redis | null {
    if (!process.env.REDIS_URL || Date.now() < this.cooldownUntil) return null;
    if (!this.redis) {
      this.redis = new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
      });
      this.redis.on('error', () => undefined);
    }
    return this.redis;
  }

  async invalidate(keys: string[]): Promise<number> {
    const client = this.client();
    if (!client || keys.length === 0) return 0;
    try {
      if (client.status !== 'ready') await client.connect();
      return (await client.del(...keys)) as number;
    } catch {
      this.cooldownUntil = Date.now() + 5_000;
      try {
        this.redis?.disconnect();
      } catch {
        // teardown best-effort
      }
      this.redis = null;
      return 0;
    }
  }
}

const OUTBOX_INSERT =
  `INSERT INTO outbox_events (id, "eventId", aggregate, "aggregateId", type, payload, "occurredAt")` +
  ` VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) ON CONFLICT ("eventId") DO NOTHING`;

async function emitAccessOutbox(
  db: SqlRunner,
  row: { eventId: string; aggregate: string; aggregateId: string; type: string; payload: unknown; occurredAt: string },
): Promise<boolean> {
  const r = await db.query(OUTBOX_INSERT, [
    randomUUID(),
    row.eventId,
    row.aggregate,
    row.aggregateId,
    row.type,
    JSON.stringify(row.payload ?? {}),
    row.occurredAt,
  ]);
  return (r.rowCount ?? 0) > 0;
}

export type HandleResult =
  | { duplicate: true; eventId: string }
  | { duplicate: false; eventId: string; kind: string; entitlements: string[]; invalidated: string[]; outbox: boolean; noop?: string };

@Injectable()
export class LicensingSyncService {
  private readonly log = new Logger(LicensingSyncService.name);
  private cache: CacheInvalidator = new RedisCacheInvalidator();
  private licensingDb: SqlRunner | null = null;

  constructor(@Inject(ACCESS_POOL) private readonly db: SqlRunner) {}

  withCache(cache: CacheInvalidator): this {
    this.cache = cache;
    return this;
  }

  withLicensingDb(db: SqlRunner): this {
    this.licensingDb = db;
    return this;
  }

  async handleEnvelope(raw: unknown, now: Date = new Date()): Promise<HandleResult> {
    const parsed = parseLicenseEnvelope(raw);
    if (!parsed.ok) {
      this.log.warn(`sync descartado: ${parsed.errors.join('; ')}`);
      return { duplicate: false, eventId: 'desconhecido', kind: 'invalid', entitlements: [], invalidated: [], outbox: false, noop: parsed.errors.join('; ') };
    }
    const { envelope, kind } = parsed;

    // 1. Guarda de idempotência: replay do mesmo eventId não duplica nada.
    const guard = await this.db.query(OUTBOX_INSERT, [
      envelope.eventId,
      'license_sync',
      String(envelope.payload.licenseId ?? envelope.eventId),
      `licensing.sync.consumed.v1`,
      JSON.stringify({ topic: envelope.topic, version: envelope.version }),
      envelope.occurredAt,
    ]);
    if ((guard.rowCount ?? 0) === 0) return { duplicate: true, eventId: envelope.eventId };

    // 2. Aplica efeito.
    const upserts = entitlementUpsertsFor(envelope, kind, now);
    const entitlementIds: string[] = [];
    if (upserts) {
      for (const u of upserts) {
        if (u.status === 'REVOKED' || u.status === 'SUSPENDED') {
          await this.applyTerminalLike(u);
        } else {
          const id = await this.upsertLicenseEntitlement(u);
          if (id) entitlementIds.push(id);
        }
      }
    }

    // 3. Espelho no outbox access (replay-safe: eventId derivado determinístico).
    let outbox = false;
    if (upserts || kind === 'clone-suspect') {
      outbox = await emitAccessOutbox(this.db, {
        eventId: `${envelope.eventId}:access`,
        aggregate: 'entitlement',
        aggregateId: String(envelope.payload.licenseId),
        type: 'access.entitlement.updated.v1',
        payload: { topic: envelope.topic, kind, licenseId: envelope.payload.licenseId, upserts },
        occurredAt: envelope.occurredAt,
      });
    }

    // 4. Invalida cache (best-effort; chaves retornadas p/ observabilidade/teste).
    const invalidated = await this.invalidateForEnvelope(envelope.payload);
    return { duplicate: false, eventId: envelope.eventId, kind, entitlements: entitlementIds, invalidated, outbox };
  }

  private async upsertLicenseEntitlement(u: LicenseEntitlementUpsert): Promise<string | null> {
    const { rows } = await this.db.query(
      `INSERT INTO entitlements
         (id, "ownerType", "ownerId", "productId", "featureCode", channel, origin, "originId",
          priority, status, "startsAt", "expiresAt", "graceUntil", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())
       ON CONFLICT ("ownerType", "ownerId", "productId", "featureCode", origin, "originId")
       DO UPDATE SET
         status = CASE WHEN entitlements.status = 'REVOKED' THEN 'REVOKED' ELSE EXCLUDED.status END,
         priority = EXCLUDED.priority,
         channel = EXCLUDED.channel,
         "startsAt" = EXCLUDED."startsAt", "expiresAt" = EXCLUDED."expiresAt",
         "graceUntil" = EXCLUDED."graceUntil", "updatedAt" = now()
       RETURNING id, status`,
      [
        randomUUID(), u.ownerType, u.ownerId, u.productId, u.featureCode,
        u.channel, u.origin, u.originId, u.priority, u.status, u.startsAt, u.expiresAt, u.graceUntil,
      ],
    );
    return (rows[0]?.id as string) ?? null;
  }

  private async applyTerminalLike(u: LicenseEntitlementUpsert): Promise<void> {
    // REVOKED: aplica sobre qualquer estado não-terminal. SUSPENDED: só sobre
    // ACTIVE/GRACE/SUSPENDED (nunca congela um EXPIRED nem toca REVOKED).
    // Fase 8: origin parametrizada (LICENSE ou SUBSCRIPTION).
    const allowed = u.status === 'REVOKED' ? `status <> 'REVOKED'` : `status IN ('ACTIVE', 'GRACE', 'SUSPENDED')`;
    await this.db.query(
      `UPDATE entitlements SET status = $1,
         "expiresAt" = COALESCE($2::timestamptz, "expiresAt"),
         "graceUntil" = COALESCE($3::timestamptz, "graceUntil"),
         "updatedAt" = now()
       WHERE "ownerType" = $4 AND "ownerId" = $5 AND "productId" = $6
         AND "featureCode" = $7 AND origin = $8 AND "originId" = $9 AND ${allowed}`,
      [u.status, u.expiresAt, u.graceUntil, u.ownerType, u.ownerId, u.productId, u.featureCode, u.origin, u.originId],
    );
  }

  private async invalidateForEnvelope(payload: Record<string, unknown>): Promise<string[]> {
    const ownerId = typeof payload.ownerId === 'string' ? payload.ownerId : null;
    const productId = typeof payload.productId === 'string' ? payload.productId : null;
    if (!ownerId || !productId) return [];
    const ownerType = typeof payload.ownerType === 'string' ? payload.ownerType : 'CUSTOMER';
    const { codes } = featureCodesFor(payload);
    const keys = codes.flatMap((f) => accessCacheKeys(ownerType, ownerId, productId, f));
    await this.cache.invalidate(keys);
    return keys;
  }

  /**
   * Cascata Contract cancel → Item → Entitlement → License.
   * Lado access executa nesta transação lógica (statements idempotentes
   * sequenciais); lado licensing executa se `withLicensingDb` foi dado, senão
   * as linhas de outbox `licensing` voltam em `pendingLicensingOutbox`.
   */
  async executeCascade(input: CascadeInput): Promise<{
    contract: string;
    itemsCancelled: number;
    entitlementsRevoked: number;
    license: { applied: number; tokenVersions: Record<string, number>; persisted: boolean } | { skipped: string };
    outboxEmitted: number;
    pendingLicensingOutbox: number;
  }> {
    const plan = planRevocationCascade(input);
    if (plan.contract.applied) {
      await this.db.query(`UPDATE contracts SET status = 'CANCELLED', "updatedAt" = now() WHERE id = $1 AND status NOT IN ('CANCELLED', 'EXPIRED')`, [input.contractId]);
    }
    let itemsCancelled = 0;
    for (let i = 0; i < input.items.length; i++) {
      if (!plan.items[i].applied) continue;
      const r = await this.db.query(
        `UPDATE contract_items SET status = 'CANCELLED', "updatedAt" = now() WHERE id = $1 AND status NOT IN ('CANCELLED', 'EXPIRED')`,
        [input.items[i].itemId],
      );
      itemsCancelled += r.rowCount ?? 0;
    }
    let entitlementsRevoked = 0;
    for (let i = 0; i < input.items.length; i++) {
      if (plan.entitlements[i] && !plan.entitlements[i].applied) continue;
      const item = input.items[i];
      const r = await this.db.query(
        `UPDATE entitlements SET status = 'REVOKED', "updatedAt" = now()
         WHERE "ownerType" = $1 AND "ownerId" = $2 AND "productId" = $3 AND "featureCode" = $4
           AND origin = 'LICENSE' AND "originId" = $5 AND status <> 'REVOKED'`,
        [item.ownerType, item.ownerId, item.productId, item.featureCode ?? '*', item.licenseId ?? item.itemId],
      );
      entitlementsRevoked += r.rowCount ?? 0;
    }
    if (input.reason && input.reason.length >= 1) {
      await this.db.query(
        `INSERT INTO access_adjustments (id, actor, action, "targetType", "targetId", reason, "createdAt") VALUES ($1, $2, 'contract.cancel', 'CONTRACT', $3, $4, now())`,
        [randomUUID(), input.actor, input.contractId, input.reason],
      );
    }

    let outboxEmitted = 0;
    let pendingLicensingOutbox = 0;
    for (const row of plan.outbox) {
      if (row.domain === 'access') {
        if (await emitAccessOutbox(this.db, row)) outboxEmitted += 1;
      } else if (this.licensingDb) {
        const r = await this.licensingDb.query(OUTBOX_INSERT, [
          row.eventId, row.aggregate, row.aggregateId, row.type, JSON.stringify(row.payload), row.occurredAt,
        ]);
        outboxEmitted += r.rowCount ?? 0;
      } else {
        pendingLicensingOutbox += 1;
      }
    }

    const licenseOps = plan.licenses.filter((o) => o.applied);
    if (licenseOps.length === 0) {
      return { contract: plan.contract.to, itemsCancelled, entitlementsRevoked, license: { skipped: 'sem licenças a revogar' }, outboxEmitted, pendingLicensingOutbox };
    }
    if (!this.licensingDb) {
      const tokenVersions: Record<string, number> = {};
      for (const o of licenseOps) tokenVersions[o.id] = o.tokenVersion ?? 1;
      return { contract: plan.contract.to, itemsCancelled, entitlementsRevoked, license: { applied: 0, tokenVersions, persisted: false }, outboxEmitted, pendingLicensingOutbox };
    }
    let applied = 0;
    let persisted = true;
    const tokenVersions: Record<string, number> = {};
    const hasTokenVersion = await this.licensingHasTokenVersion();
    for (const o of licenseOps) {
      const r = await this.licensingDb.query(
        `UPDATE licenses SET status = 'REVOKED', "updatedAt" = now() WHERE id = $1 AND status <> 'REVOKED'`,
        [o.id],
      );
      applied += r.rowCount ?? 0;
      tokenVersions[o.id] = o.tokenVersion ?? 1;
      if (hasTokenVersion) {
        try {
          await this.licensingDb.query(`UPDATE licenses SET token_version = token_version + 1 WHERE id = $1`, [o.id]);
        } catch {
          persisted = false;
        }
      } else {
        persisted = false;
      }
    }
    return { contract: plan.contract.to, itemsCancelled, entitlementsRevoked, license: { applied, tokenVersions, persisted }, outboxEmitted, pendingLicensingOutbox };
  }

  private async licensingHasTokenVersion(): Promise<boolean> {
    if (!this.licensingDb) return false;
    try {
      const r = await this.licensingDb.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'licenses' AND column_name = 'token_version'`,
      );
      return r.rows.length > 0;
    } catch {
      return false;
    }
  }
}
