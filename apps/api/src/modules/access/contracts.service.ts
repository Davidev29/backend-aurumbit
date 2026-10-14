import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { ACCESS_POOL } from './access-pool.provider';
import { ORIGIN_PRIORITY } from './access-policy';
import { CreateContractDto, UpdateContractStatusDto, UpdateItemStatusDto } from './dto';

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

// Máquina mínima de estados (Fase 2). Provisionamento de Entitlements a partir
// do contrato acontece na confirmação do pagamento (Fase 4, Billing) — criar
// contrato NÃO autoriza nada por si só (default deny).
const CONTRACT_FLOW: Record<string, string[]> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['SUSPENDED', 'CANCELLED', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  CANCELLED: [],
  EXPIRED: [],
};

const ITEM_FLOW: Record<string, string[]> = {
  PENDING_PAYMENT: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  ACTIVE: ['SUSPENDED', 'CANCELLED', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  CANCELLED: [],
  EXPIRED: [],
};

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
export class ContractsService {
  constructor(@Inject(ACCESS_POOL) private readonly pool: Pool) {}

  async createContract(dto: CreateContractDto): Promise<{ id: string; status: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const c = await client.query(
        `INSERT INTO contracts (id, "ownerType", "ownerId", status, "startsAt", "endsAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, COALESCE($4, 'DRAFT'), $5, $6, now(), now())
         RETURNING id, status`,
        [
          randomUUID(),
          dto.ownerType,
          dto.ownerId,
          dto.status ?? null,
          dto.startsAt ?? null,
          dto.endsAt ?? null,
        ],
      );
      const contractId = c.rows[0].id as string;
      for (const item of dto.items) {
        await client.query(
          `INSERT INTO contract_items
             (id, "contractId", "planId", "productId", "unitPriceCents", quantity,
              status, "startsAt", "endsAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, 'PENDING_PAYMENT', $7, $8, now(), now())`,
          [
            randomUUID(),
            contractId,
            item.planId,
            item.productId,
            item.unitPriceCents,
            item.quantity ?? 1,
            dto.startsAt ?? null,
            dto.endsAt ?? null,
          ],
        );
      }
      await client.query('COMMIT');
      return c.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async listContracts(ownerType?: string, ownerId?: string): Promise<Record<string, unknown>[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (ownerType) {
      conds.push(`"ownerType" = $${params.length + 1}`);
      params.push(ownerType);
    }
    if (ownerId) {
      conds.push(`"ownerId" = $${params.length + 1}`);
      params.push(ownerId);
    }
    const { rows } = await this.pool.query(
      `SELECT id, "ownerType", "ownerId", status, "startsAt", "endsAt", "createdAt", "updatedAt"
       FROM contracts ${conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''}
       ORDER BY "createdAt" DESC LIMIT 100`,
      params,
    );
    return rows;
  }

  async getContract(id: string): Promise<Record<string, unknown>> {
    const { rows } = await this.pool.query(
      `SELECT id, "ownerType", "ownerId", status, "startsAt", "endsAt", "createdAt", "updatedAt"
       FROM contracts WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException(`contract ${id} não encontrado`);
    const items = await this.pool.query(
      `SELECT id, "planId", "productId", "unitPriceCents", quantity, status,
              "startsAt", "endsAt", "createdAt", "updatedAt"
       FROM contract_items WHERE "contractId" = $1 ORDER BY "createdAt" ASC`,
      [id],
    );
    return { ...rows[0], items: items.rows };
  }

  async updateContractStatus(id: string, dto: UpdateContractStatusDto): Promise<{ id: string; status: string }> {
    const cur = await this.pool.query(`SELECT status FROM contracts WHERE id = $1`, [id]);
    if (cur.rows.length === 0) throw new NotFoundException(`contract ${id} não encontrado`);
    const from = cur.rows[0].status as string;
    if (!(CONTRACT_FLOW[from] ?? []).includes(dto.status)) {
      throw new BadRequestException(`transição contract ${from} → ${dto.status} ilegal`);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE contracts SET status = $2, "updatedAt" = now() WHERE id = $1`,
        [id, dto.status],
      );
      await logAdjustment(client, {
        actor: dto.actor,
        action: `contract.${dto.status.toLowerCase()}`,
        targetType: 'CONTRACT',
        targetId: id,
        reason: dto.reason,
      });
      await client.query('COMMIT');
      return { id, status: dto.status };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async updateItemStatus(
    contractId: string,
    itemId: string,
    dto: UpdateItemStatusDto,
  ): Promise<{ id: string; status: string }> {
    const cur = await this.pool.query(
      `SELECT status FROM contract_items WHERE id = $1 AND "contractId" = $2`,
      [itemId, contractId],
    );
    if (cur.rows.length === 0) throw new NotFoundException(`item ${itemId} não encontrado`);
    const from = cur.rows[0].status as string;
    if (!(ITEM_FLOW[from] ?? []).includes(dto.status)) {
      throw new BadRequestException(`transição item ${from} → ${dto.status} ilegal`);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE contract_items SET status = $2, "updatedAt" = now() WHERE id = $1`, [
        itemId,
        dto.status,
      ]);
      await logAdjustment(client, {
        actor: dto.actor,
        action: `contract_item.${dto.status.toLowerCase()}`,
        targetType: 'CONTRACT',
        targetId: contractId,
        reason: dto.reason,
      });
      await client.query('COMMIT');
      return { id: itemId, status: dto.status };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async listEntitlements(filter: {
    ownerType?: string;
    ownerId?: string;
    productId?: string;
    featureCode?: string;
    status?: string;
  }): Promise<Record<string, unknown>[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    const eq = (col: string, v: string): void => {
      conds.push(`"${col}" = $${params.length + 1}`);
      params.push(v);
    };
    if (filter.ownerType) eq('ownerType', filter.ownerType);
    if (filter.ownerId) eq('ownerId', filter.ownerId);
    if (filter.productId) eq('productId', filter.productId);
    if (filter.featureCode) eq('featureCode', filter.featureCode);
    if (filter.status) eq('status', filter.status);
    const { rows } = await this.pool.query(
      `SELECT id, "ownerType", "ownerId", "productId", "featureCode", origin, "originId",
              priority, status, "quotaValue", "startsAt", "expiresAt", "graceUntil",
              "createdAt", "updatedAt"
       FROM entitlements ${conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''}
       ORDER BY priority DESC LIMIT 200`,
      params,
    );
    return rows;
  }

  async upsertEntitlement(dto: {
    ownerType: string;
    ownerId: string;
    productId: string;
    featureCode: string;
    origin: string;
    originId: string;
    priority?: number;
    status?: string;
    quotaValue?: string;
    startsAt?: string;
    expiresAt?: string;
    graceUntil?: string;
  }): Promise<Record<string, unknown>> {
    const priority = dto.priority ?? ORIGIN_PRIORITY[dto.origin] ?? 10;
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO entitlements
           (id, "ownerType", "ownerId", "productId", "featureCode", origin, "originId",
            priority, status, "quotaValue", "startsAt", "expiresAt", "graceUntil",
            "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'ACTIVE'), $10, $11, $12, $13, now(), now())
         ON CONFLICT ("ownerType", "ownerId", "productId", "featureCode", origin, "originId")
         DO UPDATE SET priority = EXCLUDED.priority, status = EXCLUDED.status,
           "quotaValue" = EXCLUDED."quotaValue", "startsAt" = EXCLUDED."startsAt",
           "expiresAt" = EXCLUDED."expiresAt", "graceUntil" = EXCLUDED."graceUntil",
           "updatedAt" = now()
         RETURNING id, status, priority`,
        [
          randomUUID(),
          dto.ownerType,
          dto.ownerId,
          dto.productId,
          dto.featureCode,
          dto.origin,
          dto.originId,
          priority,
          dto.status ?? null,
          dto.quotaValue ?? null,
          dto.startsAt ?? null,
          dto.expiresAt ?? null,
          dto.graceUntil ?? null,
        ],
      );
      return rows[0];
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('entitlement já existe');
      throw e;
    }
  }
}
