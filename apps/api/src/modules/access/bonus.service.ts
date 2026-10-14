import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { ACCESS_POOL } from './access-pool.provider';
import { ORIGIN_PRIORITY } from './access-policy';
import { GrantBonusDto, LogAdjustmentDto, RevokeBonusDto } from './dto';

function addGraceDays(base: Date): Date {
  // PROJECT.md §1: grace_until = expires_at + 3d.
  return new Date(base.getTime() + 3 * 24 * 60 * 60 * 1000);
}

async function logAdjustment(
  client: Pool | PoolClient,
  a: { actor: string; action: string; targetType?: string | null; targetId?: string | null; reason: string },
): Promise<void> {
  await client.query(
    `INSERT INTO access_adjustments (id, actor, action, "targetType", "targetId", reason, "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [randomUUID(), a.actor, a.action, a.targetType ?? null, a.targetId ?? null, a.reason],
  );
}

@Injectable()
export class BonusService {
  constructor(@Inject(ACCESS_POOL) private readonly pool: Pool) {}

  // Cortesia (reason >= 10, validado no DTO). ends_at null = vitalícia.
  // Materializa Entitlement BONUS/priority 5 quando productId+featureCode dados.
  async grantBonus(dto: GrantBonusDto): Promise<{ bonusId: string; entitlementId: string | null }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const bonusId = randomUUID();
      await client.query(
        `INSERT INTO bonus_grants
           (id, "ownerType", "ownerId", "productId", "featureCode", reason, "endsAt",
            status, "grantedBy", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, now(), now())`,
        [
          bonusId,
          dto.ownerType,
          dto.ownerId,
          dto.productId ?? null,
          dto.featureCode ?? null,
          dto.reason,
          dto.endsAt ?? null,
          dto.grantedBy,
        ],
      );
      let entitlementId: string | null = null;
      if (dto.productId && dto.featureCode) {
        const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
        const ent = await client.query(
          `INSERT INTO entitlements
             (id, "ownerType", "ownerId", "productId", "featureCode", origin, "originId",
              priority, status, "startsAt", "expiresAt", "graceUntil", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, 'BONUS', $6, $7, 'ACTIVE', now(), $8, $9, now(), now())
           ON CONFLICT ("ownerType", "ownerId", "productId", "featureCode", origin, "originId")
           DO UPDATE SET status = 'ACTIVE', "expiresAt" = EXCLUDED."expiresAt",
             "graceUntil" = EXCLUDED."graceUntil", "updatedAt" = now()
           RETURNING id`,
          [
            randomUUID(),
            dto.ownerType,
            dto.ownerId,
            dto.productId,
            dto.featureCode,
            bonusId,
            ORIGIN_PRIORITY.BONUS,
            endsAt ? endsAt.toISOString() : null,
            endsAt ? addGraceDays(endsAt).toISOString() : null,
          ],
        );
        entitlementId = ent.rows[0].id as string;
      }
      await logAdjustment(client, {
        actor: dto.grantedBy,
        action: 'bonus.grant',
        targetType: 'BONUS',
        targetId: bonusId,
        reason: dto.reason,
      });
      await client.query('COMMIT');
      return { bonusId, entitlementId };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async revokeBonus(id: string, dto: RevokeBonusDto): Promise<{ id: string; status: string }> {
    const cur = await this.pool.query(`SELECT status FROM bonus_grants WHERE id = $1`, [id]);
    if (cur.rows.length === 0) throw new NotFoundException(`bonus ${id} não encontrado`);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE bonus_grants SET status = 'REVOKED', "updatedAt" = now() WHERE id = $1`,
        [id],
      );
      await client.query(
        `UPDATE entitlements SET status = 'REVOKED', "updatedAt" = now()
         WHERE origin = 'BONUS' AND "originId" = $1 AND status <> 'REVOKED'`,
        [id],
      );
      await logAdjustment(client, {
        actor: dto.actor,
        action: 'bonus.revoke',
        targetType: 'BONUS',
        targetId: id,
        reason: dto.reason,
      });
      await client.query('COMMIT');
      return { id, status: 'REVOKED' };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async logAdjustment(dto: LogAdjustmentDto): Promise<{ id: string }> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO access_adjustments (id, actor, action, "targetType", "targetId", reason, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [id, dto.actor, dto.action, dto.targetType ?? null, dto.targetId ?? null, dto.reason],
    );
    return { id };
  }

  async listAdjustments(targetType?: string, targetId?: string): Promise<Record<string, unknown>[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (targetType) {
      conds.push(`"targetType" = $${params.length + 1}`);
      params.push(targetType);
    }
    if (targetId) {
      conds.push(`"targetId" = $${params.length + 1}`);
      params.push(targetId);
    }
    const { rows } = await this.pool.query(
      `SELECT id, actor, action, "targetType", "targetId", reason, "createdAt"
       FROM access_adjustments ${conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''}
       ORDER BY "createdAt" DESC LIMIT 100`,
      params,
    );
    return rows;
  }
}
