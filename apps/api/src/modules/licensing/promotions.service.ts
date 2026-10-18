import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { LICENSING_POOL } from './licensing-pool.provider';
import { generateLicenseKey } from './license-keys';

export type PromotionType = 'BONUS' | 'DISCOUNT';

export interface CreatePromotionInput {
  productId: string;
  type: PromotionType;
  discountPercent?: number;
  expiresInHours?: number | null;
  maxDevices?: number;
  note?: string | null;
  influencerName?: string | null;
  influencerPlatformUrl?: string | null;
  influencerSource?: string | null;
  commissionPercent?: number;
}

@Injectable()
export class PromotionsService {
  constructor(@Inject(LICENSING_POOL) private readonly pool: any) {}

  // injected via LICENSING_POOL? We'll set in module manually.
  async create(input: CreatePromotionInput) {
    const type = input.type === 'DISCOUNT' ? 'DISCOUNT' : 'BONUS';
    const discountPercent = type === 'DISCOUNT' ? Math.max(0, Math.min(100, input.discountPercent ?? 0)) : 0;
    const commissionPercent = type === 'DISCOUNT' ? Math.max(0, Math.min(100, input.commissionPercent ?? 0)) : 0;
    const maxDevices = input.maxDevices ?? (type === 'BONUS' ? 1 : 3);
    const expiresInHours = input.expiresInHours ?? null;
    // partial key: generate full key then mask last 4 digits.
    const fullKey = generateLicenseKey();
    const partial = fullKey.slice(0, fullKey.length - 4) + '****';
    const basePrefix = fullKey.slice(0, fullKey.length - 4);
    const baseHash = createHash('sha256').update(fullKey).digest('hex');
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO promotions (id, "productId", type, "promoCode", "discountPercent", "expiresInHours", "maxDevices", note,
        "influencerName", "influencerPlatformUrl", "influencerSource", "commissionPercent", "keyBasePrefix", "keyBaseHash", status, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ACTIVE',now(),now())
       RETURNING *`,
      [
        id,
        input.productId,
        type,
        partial,
        discountPercent,
        expiresInHours,
        maxDevices,
        input.note ?? null,
        input.influencerName ?? null,
        input.influencerPlatformUrl ?? null,
        input.influencerSource ?? null,
        commissionPercent,
        basePrefix,
        baseHash,
      ],
    );
    return rows[0];
  }

  async listByProduct(productId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM promotions WHERE "productId" = $1 ORDER BY "createdAt" DESC`,
      [productId],
    );
    return rows;
  }

  async validateCode(promoCode: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM promotions WHERE "promoCode" = $1 AND status = 'ACTIVE'`,
      [promoCode],
    );
    if (rows.length === 0) throw new NotFoundException('código promocional inválido ou inativo.');
    const promo = rows[0] as { expiresInHours?: number | null; createdAt?: string | Date };
    if (promo.expiresInHours && promo.createdAt) {
      const created = new Date(promo.createdAt).getTime();
      if (Date.now() > created + promo.expiresInHours * 3600_000) {
        throw new NotFoundException('código promocional expirado.');
      }
    }
    return rows[0];
  }

  async get(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM promotions WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('promoção não encontrada.');
    return rows[0];
  }
}
