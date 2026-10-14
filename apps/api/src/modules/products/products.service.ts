import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { CreateProductDto, CreateVersionDto } from './dto';
import { PRODUCTS_POOL } from './products-pool.provider';

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

export type ProductImageView = {
  id: string;
  filename: string;
  originalName: string;
  mime: string;
  size: number;
  url: string;
  createdAt: Date;
};

export function imageUrlOf(filename: string): string {
  return `/v1/product-images/${filename}`;
}

export type ProductDetail = {
  id: string;
  code: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  machinesAllowed: number;
  createdAt: Date;
  updatedAt: Date;
  versions: Array<{ id: string; version: string; changelog: string | null; createdAt: Date }>;
  images: ProductImageView[];
};

const PRODUCT_COLS = `id, code, name, slug, description, status, machines_allowed AS "machinesAllowed",
  "createdAt", "updatedAt"`;

function toImageView(row: {
  id: string;
  filename: string;
  originalName: string;
  mime: string;
  size_bytes: number;
  createdAt: Date;
}): ProductImageView {
  return {
    id: row.id,
    filename: row.filename,
    originalName: row.originalName,
    mime: row.mime,
    size: row.size_bytes,
    url: imageUrlOf(row.filename),
    createdAt: row.createdAt,
  };
}

@Injectable()
export class ProductsService {
  constructor(@Inject(PRODUCTS_POOL) private readonly pool: Pool) {}

  private async listImages(productId: string): Promise<ProductImageView[]> {
    const { rows } = await this.pool.query(
      `SELECT id, filename, original_name AS "originalName", mime,
        size_bytes, created_at AS "createdAt"
       FROM product_images WHERE product_id = $1 ORDER BY created_at ASC`,
      [productId],
    );
    return rows.map(toImageView);
  }

  async listProducts(): Promise<Omit<ProductDetail, 'versions' | 'images'>[]> {
    // Catálogo público: só linhas ACTIVE.
    const { rows } = await this.pool.query(
      `SELECT ${PRODUCT_COLS}
       FROM products WHERE status = 'ACTIVE' ORDER BY code ASC`,
    );
    return rows;
  }

  async getProduct(code: string): Promise<ProductDetail> {
    const { rows } = await this.pool.query(
      `SELECT ${PRODUCT_COLS}
       FROM products WHERE code = $1`,
      [code],
    );
    if (rows.length === 0) throw new NotFoundException(`product ${code} não encontrado`);
    const versions = await this.pool.query(
      `SELECT id, version, changelog, "createdAt"
       FROM product_versions WHERE "productId" = $1 ORDER BY "createdAt" ASC`,
      [rows[0].id],
    );
    return { ...rows[0], versions: versions.rows, images: await this.listImages(rows[0].id) };
  }

  async createProduct(dto: CreateProductDto): Promise<Omit<ProductDetail, 'versions' | 'images'>> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO products (id, code, name, slug, description, status, machines_allowed, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'ACTIVE'), COALESCE($7, 3), now(), now())
         RETURNING ${PRODUCT_COLS}`,
        [
          randomUUID(),
          dto.code,
          dto.name,
          dto.slug,
          dto.description ?? null,
          dto.status ?? null,
          dto.machinesAllowed ?? null,
        ],
      );
      return rows[0];
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('product code/slug já existe');
      throw e;
    }
  }

  async addVersion(code: string, dto: CreateVersionDto): Promise<{ id: string; version: string }> {
    const { rows } = await this.pool.query(`SELECT id FROM products WHERE code = $1`, [code]);
    if (rows.length === 0) throw new NotFoundException(`product ${code} não encontrado`);
    try {
      const ins = await this.pool.query(
        `INSERT INTO product_versions (id, "productId", version, changelog, "createdAt")
         VALUES ($1, $2, $3, $4, now()) RETURNING id, version`,
        [randomUUID(), rows[0].id, dto.version, dto.changelog ?? null],
      );
      return ins.rows[0];
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('versão já existe para este produto');
      throw e;
    }
  }

  async archiveProduct(code: string): Promise<{ code: string; status: string }> {
    const { rows } = await this.pool.query(
      `UPDATE products SET status = 'ARCHIVED', "updatedAt" = now()
       WHERE code = $1 AND status <> 'ARCHIVED' RETURNING code, status`,
      [code],
    );
    if (rows.length === 0) throw new NotFoundException(`product ${code} não encontrado ou já arquivado`);
    return rows[0];
  }
}
