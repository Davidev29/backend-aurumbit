import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  CreateProductDto,
  CreateVersionDto,
  PRODUCT_IMMUTABLE_FIELDS,
  PRODUCT_PLATFORM_IDS,
  PRODUCT_SLUG_PATTERN,
  ReplaceProductDto,
  UpdateProductDto,
} from './dto';
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
  // Slugs do catálogo canônico, já normalizados (dedup + ordem canônica).
  // [] = nenhuma plataforma declarada (NÃO é "todas").
  platforms: string[];
  deliveryMode: string;
  createdAt: Date;
  updatedAt: Date;
  versions: Array<{ id: string; version: string; changelog: string | null; createdAt: Date }>;
  images: ProductImageView[];
};

const PRODUCT_COLS = `id, code, name, slug, description, status, machines_allowed AS "machinesAllowed",
  platforms, delivery_mode AS "deliveryMode", "createdAt", "updatedAt"`;

const PLATFORM_SET: ReadonlySet<string> = new Set(PRODUCT_PLATFORM_IDS);

/**
 * LISTA BRANCA de escrita de produto (`PATCH`/`PUT`).
 *
 * A chave é o nome PÚBLICO do campo no corpo; o valor é a coluna física (e o
 * cast do placeholder). O SQL é montado SÓ a partir daqui: nenhum nome de
 * coluna, nenhum tipo e nenhum placeholder vem do payload do cliente — os
 * valores vão sempre como `$n` (driver `pg` parametrizado). Um corpo com
 * `{"platforms; DROP TABLE products": 1}` nunca chega a virar SQL: a chave não
 * existe no mapa e é recusada por `assertWritableShape` antes do statement.
 *
 * A ordem do array é fixa (não a ordem de chegada do JSON) para o SQL ser
 * determinístico no log/cache de plano e para o teste poder afirmar o
 * statement exato.
 */
const WRITABLE_COLUMNS: ReadonlyArray<{
  key: string;
  column: string;
  cast?: string;
  nullable?: boolean;
}> = [
  { key: 'name', column: 'name' },
  { key: 'slug', column: 'slug' },
  { key: 'description', column: 'description', nullable: true },
  { key: 'machinesAllowed', column: 'machines_allowed' },
  { key: 'platforms', column: 'platforms', cast: 'text[]' },
  { key: 'deliveryMode', column: 'delivery_mode' },
];

const WRITABLE_KEYS: readonly string[] = WRITABLE_COLUMNS.map((c) => c.key);

/** Só `description` aceita `null` (limpar). Os demais são NOT NULL no banco. */
const NULLABLE_KEYS: ReadonlySet<string> = new Set(
  WRITABLE_COLUMNS.filter((c) => c.nullable).map((c) => c.key),
);

export type ProductWriteInput = UpdateProductDto | ReplaceProductDto;

/**
 * Recusa campos proibidos (imutáveis) e chaves desconhecidas ANTES do banco.
 *
 * Dupla função, de propósito:
 * - no caminho HTTP o `ValidationPipe` global já barrou `code`/`status`/preço
 *   com 400 e o motivo; aqui o mesmo conjunto é recusado de novo porque esta
 *   função é a barreira para quem chama o service sem passar pelo pipe;
 * - chave totalmente fora do catálogo (`tags`, `__proto__`, `slug = 1`...)
 *   também é RECUSADA (422), nunca "ignorada em silêncio": ignorar faria o
 *   operador acreditar que salvou um campo que não existe.
 *
 * PRESENÇA = valor definido, não existência da chave: o tsconfig do repo
 * compila para ES2022 (`useDefineForClassFields`), então a instância do DTO
 * já vem com TODAS as propriedades declaradas como `undefined` — `Object.keys`
 * do DTO inclui `code` mesmo quando o cliente não mandou nada. Julgar por
 * `key in dto` rejeitaria todo patch.
 */
export function assertWritableShape(input: unknown): void {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new BadRequestException('O corpo da requisição deve ser um objeto JSON com os campos do produto.');
  }
  const record = input as Record<string, unknown>;
  const forbidden = PRODUCT_IMMUTABLE_FIELDS;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) continue;
    const reason = forbidden[key];
    if (reason) throw new UnprocessableEntityException(reason);
    if (!WRITABLE_KEYS.includes(key)) {
      throw new UnprocessableEntityException(
        `O campo "${key}" não pode ser editado em produto. Campos editáveis: ${WRITABLE_KEYS.join(', ')}.`,
      );
    }
  }
}

/**
 * Núcleo compartilhado por PATCH e PUT.
 *
 * `requireAll` é a ÚNICA diferença entre os dois verbos:
 * - PATCH (`false`): campos presentes mudam, ausentes ficam; nada presente = 400;
 * - PUT (`true`): a ausência de qualquer campo é 400 listando o que falta —
 *   é isto que impede "degradar PUT em update parcial" e a divergência
 *   silenciosa entre o que o operador acha que gravou e o que ficou gravado.
 */
function assertWritableValues(input: Record<string, unknown>, requireAll: boolean): void {
  if (requireAll) {
    const missing = WRITABLE_KEYS.filter((key) => input[key] === undefined);
    if (missing.length > 0) {
      throw new BadRequestException(
        `A substituição total (PUT) exige todos os campos do produto. Faltam: ${missing.join(', ')}.`,
      );
    }
    // REGRA (rev. 2026-10-17, F-15): a substituição total exige produto
    // completo, então precisa declarar onde ele roda — igual ao
    // `POST /v1/products`. O PATCH libera `[]` porque é edição pontual e um
    // produto em pré-venda pode ficar legitimamente sem plataforma declarada
    // (é o padrão do banco). Espelha exatamente a BFF admin, que é o
    // chamador canônico — as duas pontas precisam dar a mesma resposta.
    if (Array.isArray(input.platforms) && normalizePlatforms(input.platforms).length === 0) {
      throw new UnprocessableEntityException(
        'A substituição total (PUT) exige ao menos uma plataforma. Para retirar todas, use a edição parcial (PATCH).',
      );
    }
  } else if (WRITABLE_KEYS.every((key) => input[key] === undefined)) {
    throw new BadRequestException(
      `Nada a alterar: informe ao menos um destes campos — ${WRITABLE_KEYS.join(', ')}.`,
    );
  }
  // `null` é valor válido SÓ onde a coluna aceita (description). Nos demais é
  // erro de tipo explícito, não "apaga a coluna".
  for (const key of WRITABLE_KEYS) {
    if (input[key] === null && !NULLABLE_KEYS.has(key)) {
      throw new UnprocessableEntityException(
        `O campo "${key}" não aceita valor nulo. Para limpar as plataformas, envie uma lista vazia na edição parcial (PATCH).`,
      );
    }
  }
  if (typeof input.slug === 'string' && !PRODUCT_SLUG_PATTERN.test(input.slug)) {
    throw new UnprocessableEntityException(
      'O slug deve usar apenas letras minúsculas, números e hífen simples (ex.: "aurum-pro").',
    );
  }
}

/**
 * Normaliza a lista de plataformas vinda do caller: trim + dedup + ordem
 * CANÔNICA do catálogo (windows, macos, linux, web, apple) — nunca a ordem de
 * chegada nem alfabética, senão o mesmo conjunto produce bytes diferentes no
 * banco e quebra comparação/ordenação.
 *
 * Fail-closed: slug fora do catálogo é REJEITADO (400), nunca descartado em
 * silêncio — "aceitar e ignorar" faria o admin achar que salvou uma plataforma
 * que o sistema nunca vai reconhecer.
 */
export function normalizePlatforms(input: readonly string[] | null | undefined): string[] {
  if (input === null || input === undefined) return [];
  const trimmed = input.map((raw) => (typeof raw === 'string' ? raw.trim() : String(raw)));
  const unknown = trimmed.filter((slug) => !PLATFORM_SET.has(slug));
  if (unknown.length > 0) {
    throw new BadRequestException(
      `platform desconhecida: ${[...new Set(unknown)].join(', ')} (válidas: ${PRODUCT_PLATFORM_IDS.join(', ')})`,
    );
  }
  const wanted = new Set(trimmed);
  return PRODUCT_PLATFORM_IDS.filter((slug) => wanted.has(slug));
}

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
    // Valida ANTES de tocar o banco: plataforma inválida não chega ao INSERT.
    const platforms = normalizePlatforms(dto.platforms);
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO products (id, code, name, slug, description, status, machines_allowed,
           platforms, delivery_mode, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'ACTIVE'), COALESCE($7, 3), $8::text[], COALESCE($9, 'OFFLINE'), now(), now())
         RETURNING ${PRODUCT_COLS}`,
        [
          randomUUID(),
          dto.code,
          dto.name,
          dto.slug,
          dto.description ?? null,
          dto.status ?? null,
          dto.machinesAllowed ?? null,
          platforms,
          dto.deliveryMode ?? null,
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

  /**
   * `PATCH /v1/products/:code` — só os campos presentes mudam; ausente = intacto.
   *
   * Idempotente por construção: o statement é derivado do corpo, não do estado
   * anterior, e não acumula nada (sem append de versão/plano). Repetir o mesmo
   * corpo deixa o mesmo estado — o único valor que anda é `updatedAt`, que é
   * metadata de auditoria, não conteúdo.
   */
  async updateProduct(code: string, dto: UpdateProductDto): Promise<ProductDetail> {
    return this.writeProduct(code, dto, false);
  }

  /** `PUT /v1/products/:code` — substituição total (todos os campos obrigatórios). */
  async replaceProduct(code: string, dto: ReplaceProductDto): Promise<ProductDetail> {
    return this.writeProduct(code, dto, true);
  }

  /**
   * Um (e só um) `UPDATE ... WHERE code = $1 RETURNING <projeção>`.
   *
   * Sem SELECT-then-UPDATE: a linha que grava é a mesma que filtra, então não
   * existe janela entre "ler" e "escrever" (lost update) — o `UPDATE` toma o
   * lock da linha e o `RETURNING` devolve o estado JÁ gravado, no mesmo
   * round-trip, sem segunda ida ao banco.
   *
   * As 2 leituras seguintes (versões + imagens) só MONTAM o detalhe; não
   * participam da decisão de gravação e rodam em paralelo. Não há N+1: são
   * exatamente 2, fixas, para qualquer quantidade de campos.
   */
  private async writeProduct(
    code: string,
    input: ProductWriteInput,
    requireAll: boolean,
  ): Promise<ProductDetail> {
    assertWritableShape(input);
    const record = input as Record<string, unknown>;
    assertWritableValues(record, requireAll);

    const platforms =
      record.platforms === undefined ? undefined : normalizePlatforms(record.platforms as string[]);

    const values: unknown[] = [code];
    const sets: string[] = [];
    for (const { key, column, cast } of WRITABLE_COLUMNS) {
      if (record[key] === undefined) continue; // ausente = preservado
      values.push(key === 'platforms' ? platforms : record[key]);
      // O nome da coluna vem de WRITABLE_COLUMNS; o placeholder é sequencial.
      sets.push(`${column} = $${values.length}${cast ? `::${cast}` : ''}`);
    }
    sets.push('"updatedAt" = now()');

    let rows: Array<Omit<ProductDetail, 'versions' | 'images'>>;
    try {
      ({ rows } = await this.pool.query(
        `UPDATE products SET ${sets.join(', ')} WHERE code = $1 RETURNING ${PRODUCT_COLS}`,
        values,
      ));
    } catch (e) {
      // `code` é imutável e não entra no SET → a única UNIQUE que pode bater
      // aqui é `slug` (23505). Traduzido para 409 com o valor tentado, senão o
      // operador veria 500 para "slug em uso".
      if (isUniqueViolation(e)) {
        const wanted = record.slug;
        throw new ConflictException(
          typeof wanted === 'string' && wanted.length > 0
            ? `O slug "${wanted}" já está em uso por outro produto.`
            : 'Este slug já está em uso por outro produto.',
        );
      }
      throw e;
    }
    if (rows.length === 0) throw new NotFoundException(`product ${code} não encontrado`);

    const [versions, images] = await Promise.all([
      this.pool.query(
        `SELECT id, version, changelog, "createdAt"
         FROM product_versions WHERE "productId" = $1 ORDER BY "createdAt" ASC`,
        [rows[0].id],
      ),
      this.listImages(rows[0].id),
    ]);
    return { ...rows[0], versions: versions.rows, images };
  }
}
