import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { ArchivePlanDto, CreateFeatureDto, CreatePlanDto } from './dto';
import { PRODUCTS_POOL } from './products-pool.provider';

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

export type PlanFeatureView = {
  featureCode: string;
  featureName: string;
  kind: string;
  channel: string;
  unit: string | null;
  value: string | null;
};

export type PlanView = {
  id: string;
  productCode: string;
  code: string;
  name: string;
  priceCents: number;
  billingInterval: string;
  validFrom: Date;
  validTo: Date | null;
  status: string;
  supersededBy: string | null;
  features: PlanFeatureView[];
};

const PLAN_COLS = `p.id, p.code, p.name, p."priceCents", p."billingInterval",
  p."validFrom", p."validTo", p.status, p."supersededBy", pr.code AS "productCode"`;

async function loadFeatures(client: Pool | PoolClient, planId: string): Promise<PlanFeatureView[]> {
  const { rows } = await client.query(
    `SELECT f.code AS "featureCode", f.name AS "featureName", f.kind,
            COALESCE(f.channel, 'BOTH') AS channel, f.unit, pf.value
     FROM plan_features pf JOIN features f ON f.id = pf."featureId"
     WHERE pf."planId" = $1 ORDER BY f.code ASC`,
    [planId],
  );
  return rows;
}

async function toPlanView(
  client: Pool | PoolClient,
  row: Record<string, unknown> & { id: string },
): Promise<PlanView> {
  return { ...(row as Omit<PlanView, 'features'>), features: await loadFeatures(client, row.id) };
}

@Injectable()
export class FeaturesService {
  constructor(@Inject(PRODUCTS_POOL) private readonly pool: Pool) {}

  async listFeatures(kind?: string): Promise<
    Array<{ code: string; name: string; kind: string; channel: string; unit: string | null }>
  > {
    const { rows } = await this.pool.query(
      kind
        ? `SELECT code, name, kind, COALESCE(channel, 'BOTH') AS channel, unit FROM features WHERE kind = $1 ORDER BY code ASC`
        : `SELECT code, name, kind, COALESCE(channel, 'BOTH') AS channel, unit FROM features ORDER BY code ASC`,
      kind ? [kind] : [],
    );
    return rows;
  }

  async createFeature(dto: CreateFeatureDto): Promise<{ code: string; kind: string }> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO features (id, code, name, description, kind, unit, channel, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'BOTH'), now()) RETURNING code, kind`,
        [randomUUID(), dto.code, dto.name, dto.description ?? null, dto.kind, dto.unit ?? null, dto.channel ?? null],
      );
      return rows[0];
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('feature code já existe');
      throw e;
    }
  }
}

@Injectable()
export class PlansService {
  constructor(@Inject(PRODUCTS_POOL) private readonly pool: Pool) {}

  // Catálogo público: por padrão só linhas ACTIVE.
  async listPlans(productCode?: string, status = 'ACTIVE'): Promise<PlanView[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (status !== 'ALL') {
      conds.push(`p.status = $${params.length + 1}`);
      params.push(status);
    }
    if (productCode) {
      conds.push(`pr.code = $${params.length + 1}`);
      params.push(productCode);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT ${PLAN_COLS} FROM product_plans p JOIN products pr ON pr.id = p."productId"
       ${where} ORDER BY pr.code ASC, p.code ASC, p."validFrom" DESC`,
      params,
    );
    return Promise.all(rows.map((r) => toPlanView(this.pool, r)));
  }

  // Linha vigente: a mais recente com validFrom <= now entre as ACTIVE do code.
  async getPlan(code: string, now = new Date()): Promise<PlanView> {
    const { rows } = await this.pool.query(
      `SELECT ${PLAN_COLS} FROM product_plans p JOIN products pr ON pr.id = p."productId"
       WHERE p.code = $1 AND p.status = 'ACTIVE' AND p."validFrom" <= $2
       ORDER BY p."validFrom" DESC LIMIT 1`,
      [code, now.toISOString()],
    );
    if (rows.length === 0) throw new NotFoundException(`plan ${code} vigente não encontrado`);
    return toPlanView(this.pool, rows[0]);
  }

  // Nova linha de catálogo (preço congelado na linha; sem update — imutabilidade).
  async createPlan(dto: CreatePlanDto): Promise<PlanView> {
    const prod = await this.pool.query(`SELECT id FROM products WHERE code = $1`, [dto.productCode]);
    if (prod.rows.length === 0) {
      throw new NotFoundException(`product ${dto.productCode} não encontrado`);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let planId: string;
      try {
        const ins = await client.query(
          `INSERT INTO product_plans
             (id, "productId", code, name, "priceCents", "billingInterval",
              "validFrom", "validTo", status, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', now(), now())
           RETURNING id`,
          [
            randomUUID(),
            prod.rows[0].id,
            dto.code,
            dto.name,
            dto.priceCents,
            dto.billingInterval,
            dto.validFrom,
            dto.validTo ?? null,
          ],
        );
        planId = ins.rows[0].id as string;
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new ConflictException('plan (code + valid_from) já existe — crie nova vigência');
        }
        throw e;
      }
      for (const f of dto.features ?? []) {
        const feat = await client.query(`SELECT id FROM features WHERE code = $1`, [f.featureCode]);
        if (feat.rows.length === 0) {
          throw new BadRequestException(`feature ${f.featureCode} não existe`);
        }
        await client.query(
          `INSERT INTO plan_features ("planId", "featureId", value, "createdAt")
           VALUES ($1, $2, $3, now())`,
          [planId, feat.rows[0].id, f.value ?? null],
        );
      }
      await client.query('COMMIT');
      const view = await client.query(
        `SELECT ${PLAN_COLS} FROM product_plans p JOIN products pr ON pr.id = p."productId"
         WHERE p.id = $1`,
        [planId],
      );
      return toPlanView(this.pool, view.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async archivePlan(id: string, dto: ArchivePlanDto): Promise<{ id: string; status: string }> {
    if (dto.supersededBy) {
      const succ = await this.pool.query(`SELECT id FROM product_plans WHERE id = $1`, [
        dto.supersededBy,
      ]);
      if (succ.rows.length === 0) throw new NotFoundException('plan sucessor não encontrado');
    }
    const { rows } = await this.pool.query(
      `UPDATE product_plans SET status = 'ARCHIVED', "supersededBy" = COALESCE($2, "supersededBy"),
        "updatedAt" = now()
       WHERE id = $1 AND status <> 'ARCHIVED' RETURNING id, status`,
      [id, dto.supersededBy ?? null],
    );
    if (rows.length === 0) throw new NotFoundException(`plan ${id} não encontrado ou já arquivado`);
    return rows[0];
  }

  // Ativa linha DRAFT (fluxo BFF: create → archive anterior → activate nova).
  // Idempotente: ACTIVE → ACTIVE responde a linha sem erro.
  async activatePlan(id: string): Promise<PlanView> {
    const { rows } = await this.pool.query(
      `UPDATE product_plans SET status = 'ACTIVE', "updatedAt" = now()
       WHERE id = $1 AND status <> 'ARCHIVED'
       RETURNING id`,
      [id],
    );
    if (rows.length === 0) {
      const exists = await this.pool.query(`SELECT id FROM product_plans WHERE id = $1`, [id]);
      if (exists.rows.length === 0) throw new NotFoundException(`plan ${id} não encontrado`);
      throw new ConflictException(`plan ${id} arquivado não pode ser reativado`);
    }
    const view = await this.pool.query(
      `SELECT ${PLAN_COLS} FROM product_plans p JOIN products pr ON pr.id = p."productId"
       WHERE p.id = $1`,
      [id],
    );
    return toPlanView(this.pool, view.rows[0]);
  }
}
