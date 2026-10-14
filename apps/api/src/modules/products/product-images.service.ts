import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Pool } from 'pg';
import { imageUrlOf, type ProductImageView } from './products.service';
import { PRODUCTS_POOL } from './products-pool.provider';

// Galeria em disco (VPS): metadados em `product_images`, bytes em
// PRODUCT_IMAGES_DIR (default <cwd>/data/product-images; NUNCA no repo).
// filename = `uuid+ext` (basename puro — anti path-traversal).

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

export type UploadedImageFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export function resolveImagesDir(): string {
  const configured = process.env.PRODUCT_IMAGES_DIR;
  if (configured && configured.trim().length > 0) return path.resolve(configured);
  return path.resolve(process.cwd(), 'data', 'product-images');
}

/** Extensão segura a partir do mime (allowlist image/*); null = rejeitar. */
export function extensionFor(mimetype: string): string | null {
  if (typeof mimetype !== 'string' || !mimetype.toLowerCase().startsWith('image/')) return null;
  return MIME_TO_EXT[mimetype.toLowerCase()] ?? null;
}

/** Valida upload (mime image/* allowlist + tamanho ≤ 5MB). */
export function assertValidImage(file: UploadedImageFile): string {
  if (!file || typeof file !== 'object') throw new BadRequestException('arquivo ausente (campo "file")');
  const ext = extensionFor(file.mimetype);
  if (!ext) throw new BadRequestException('apenas image/* (png/jpeg/gif/webp/svg/bmp/avif/ico)');
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new BadRequestException('arquivo vazio');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new BadRequestException('imagem excede 5MB');
  }
  if (!file.buffer || file.buffer.length === 0) throw new BadRequestException('arquivo ausente');
  return ext;
}

@Injectable()
export class ProductImagesService {
  constructor(@Inject(PRODUCTS_POOL) private readonly pool: Pool) {}

  private dir(): string {
    return resolveImagesDir();
  }

  async saveImage(code: string, file: UploadedImageFile): Promise<ProductImageView> {
    const ext = assertValidImage(file);
    const { rows } = await this.pool.query(`SELECT id FROM products WHERE code = $1`, [code]);
    if (rows.length === 0) throw new NotFoundException(`product ${code} não encontrado`);
    const filename = `${randomUUID()}${ext}`;
    const dir = this.dir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), file.buffer);
    try {
      const ins = await this.pool.query(
        `INSERT INTO product_images (id, product_id, filename, original_name, mime, size_bytes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         RETURNING id, filename, original_name AS "originalName", mime, size_bytes, created_at AS "createdAt"`,
        [randomUUID(), rows[0].id, filename, file.originalname.slice(0, 255), file.mimetype, file.size],
      );
      const r = ins.rows[0];
      return {
        id: r.id,
        filename: r.filename,
        originalName: r.originalName,
        mime: r.mime,
        size: r.size_bytes,
        url: imageUrlOf(r.filename),
        createdAt: r.createdAt,
      };
    } catch (e) {
      await fs.unlink(path.join(dir, filename)).catch(() => undefined);
      throw e;
    }
  }

  async listImages(code: string): Promise<ProductImageView[]> {
    const { rows } = await this.pool.query(`SELECT id FROM products WHERE code = $1`, [code]);
    if (rows.length === 0) throw new NotFoundException(`product ${code} não encontrado`);
    const imgs = await this.pool.query(
      `SELECT id, filename, original_name AS "originalName", mime,
        size_bytes, created_at AS "createdAt"
       FROM product_images WHERE product_id = $1 ORDER BY created_at ASC`,
      [rows[0].id],
    );
    return imgs.rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      originalName: r.originalName,
      mime: r.mime,
      size: r.size_bytes,
      url: imageUrlOf(r.filename),
      createdAt: r.createdAt,
    }));
  }

  async removeImage(code: string, id: string): Promise<{ id: string; removed: boolean }> {
    const { rows } = await this.pool.query(`SELECT id FROM products WHERE code = $1`, [code]);
    if (rows.length === 0) throw new NotFoundException(`product ${code} não encontrado`);
    const del = await this.pool.query(
      `DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING filename`,
      [id, rows[0].id],
    );
    if (del.rows.length === 0) throw new NotFoundException(`image ${id} não encontrada`);
    await fs.unlink(path.join(this.dir(), path.basename(del.rows[0].filename))).catch(() => undefined);
    return { id, removed: true };
  }

  /** Stream de leitura: 404 se a linha não existe ou o byte sumiu. */
  async openImageStream(
    filename: string,
  ): Promise<{ stream: ReturnType<typeof createReadStream>; mime: string; size: number }> {
    // Anti path-traversal: basename — qualquer `/`, `\` ou `..` colapsa
    // para um nome simples que não existe na pasta (→ 404).
    const safe = path.basename(filename);
    if (!safe || safe !== filename || safe.includes('\0')) {
      throw new NotFoundException('imagem não encontrada');
    }
    const { rows } = await this.pool.query(
      `SELECT mime, size_bytes FROM product_images WHERE filename = $1`,
      [safe],
    );
    if (rows.length === 0) throw new NotFoundException('imagem não encontrada');
    const abs = path.join(this.dir(), safe);
    try {
      await fs.access(abs);
    } catch {
      throw new NotFoundException('imagem não encontrada');
    }
    return { stream: createReadStream(abs), mime: rows[0].mime, size: rows[0].size_bytes };
  }
}
