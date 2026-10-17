import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AdminStubGuard } from './admin.guard';
import { PlansService } from './plans.service';
import { PRODUCTS_POOL } from './products-pool.provider';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * Contrato HTTP de `PATCH|PUT /v1/products/:code` (guard + pipe + rota + service).
 *
 * Segue o padrão de `licensing/license-query.controller.spec.ts`: app Nest de
 * teste com o MESMO `ValidationPipe` global de `main.ts` e o pool `pg` mockado.
 * O que este arquivo prova que o spec do service não prova: que a rota existe
 * com o verbo certo, que o `AdminStubGuard` está ligado nas duas, e que o
 * `code` no corpo volta como 400 COM O MOTIVO (não o genérico do forbid).
 */
describe('ProductsController PATCH/PUT (contrato HTTP)', () => {
  let app: INestApplication;
  let query: jest.Mock;

  const admin = { 'x-role': 'admin' };

  /** Coluna física → chave do shape (espelha `PRODUCT_COLS` do service). */
  const COLUMNS: Record<string, string> = {
    name: 'name',
    slug: 'slug',
    description: 'description',
    machines_allowed: 'machinesAllowed',
    platforms: 'platforms',
    delivery_mode: 'deliveryMode',
  };

  function emptyRow(): Record<string, unknown> {
    return {
      id: 'p1',
      code: 'AURUM_X',
      name: 'Aurum X',
      slug: 'aurum-x',
      description: null,
      status: 'ACTIVE',
      machinesAllowed: 3,
      platforms: ['windows'],
      deliveryMode: 'OFFLINE',
      createdAt: new Date('2026-10-17T00:00:00.000Z'),
      updatedAt: new Date('2026-10-17T00:00:00.000Z'),
    };
  }

  /**
   * Pool com UPDATE em memória: aplica o SET do statement na linha, para a
   * resposta refletir o que o BANCO gravaria. Um mock que devolvesse sempre a
   * linha inicial faria o teste passar sem provar nada (a lição do A-MOCK-001
   * vale para spec: mock que mente esconde o bug).
   */
  function poolWith(row: Record<string, unknown>) {
    return jest.fn((sql: string, params: unknown[] = []) => {
      if (sql.startsWith('UPDATE products')) {
        const setPart = sql
          .slice('UPDATE products SET '.length)
          .split(', "updatedAt" = now()')[0]
          .split(', ');
        setPart.forEach((assign: string, i: number) => {
          const key = COLUMNS[assign.split(' = ')[0]];
          if (key) row[key] = params[i + 1];
        });
        return Promise.resolve({ rows: [{ ...row }] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  beforeEach(async () => {
    query = poolWith(emptyRow());
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: PRODUCTS_POOL, useValue: { query } },
        ProductsService,
        PlansService,
        AdminStubGuard,
      ],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('sem x-role:admin → 403 nas duas escritas (guard ligado)', async () => {
    await request(app.getHttpServer()).patch('/v1/products/AURUM_X').send({ name: 'X' }).expect(403);
    await request(app.getHttpServer())
      .put('/v1/products/AURUM_X')
      .send({ name: 'X', slug: 'x', description: null, machinesAllowed: 1, platforms: ['web'], deliveryMode: 'OFFLINE' })
      .expect(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('PATCH parcial → 200 com o detalhe completo e o SQL só com o enviado', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/products/AURUM_X')
      .set(admin)
      .send({ name: 'Aurum X Plus' })
      .expect(200);

    expect(res.body).toMatchObject({
      code: 'AURUM_X',
      name: 'Aurum X Plus',
      machinesAllowed: 3,
      versions: [],
      images: [],
    });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('name = $2');
    expect(sql).not.toContain('slug =');
    expect(query.mock.calls[0][1]).toEqual(['AURUM_X', 'Aurum X Plus']);
  });

  it('PUT com todos os campos → 200; com um a menos → 400 listando o que falta', async () => {
    const ok = await request(app.getHttpServer())
      .put('/v1/products/AURUM_X')
      .set(admin)
      .send({
        name: 'Aurum X',
        slug: 'aurum-x-novo',
        description: null,
        machinesAllowed: 7,
        platforms: ['web', 'windows'],
        deliveryMode: 'HYBRID',
      })
      .expect(200);
    expect(ok.body.machinesAllowed).toBe(7);
    expect(query.mock.calls[0][1]).toEqual([
      'AURUM_X',
      'Aurum X',
      'aurum-x-novo',
      null,
      7,
      ['windows', 'web'],
      'HYBRID',
    ]);

    query.mockClear();
    const bad = await request(app.getHttpServer())
      .put('/v1/products/AURUM_X')
      .set(admin)
      .send({ name: 'Aurum X', slug: 'aurum-x', machinesAllowed: 7, platforms: ['web'], deliveryMode: 'OFFLINE' })
      .expect(400);
    expect(String(bad.body.message)).toContain('Faltam: description');
    expect(query).not.toHaveBeenCalled();
  });

  it('code/status/preço no corpo → 400 com o motivo, sem tocar o banco', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/products/AURUM_X')
      .set(admin)
      .send({ code: 'OUTRO' })
      .expect(400);
    expect(String(res.body.message)).toContain('código do produto é imutável');
    expect(String(res.body.message)).toContain('crie um produto novo');
    expect(query).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .patch('/v1/products/AURUM_X')
      .set(admin)
      .send({ status: 'ARCHIVED' })
      .expect(400);
    await request(app.getHttpServer())
      .put('/v1/products/AURUM_X')
      .set(admin)
      .send({
        name: 'Aurum X',
        slug: 'aurum-x',
        description: null,
        machinesAllowed: 3,
        platforms: ['web'],
        deliveryMode: 'OFFLINE',
        priceCents: 1,
      })
      .expect(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('campo fora do catálogo → 400; valor inválido → 400; produto inexistente → 404', async () => {
    await request(app.getHttpServer())
      .patch('/v1/products/AURUM_X')
      .set(admin)
      .send({ name: 'ok', tags: ['a'] })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/v1/products/AURUM_X')
      .set(admin)
      .send({ platforms: ['android'] })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/v1/products/AURUM_X')
      .set(admin)
      .send({ machinesAllowed: 0 })
      .expect(400);
    expect(query).not.toHaveBeenCalled();

    query.mockReset();
    query.mockResolvedValue({ rows: [] });
    await request(app.getHttpServer())
      .patch('/v1/products/NAO_EXISTE')
      .set(admin)
      .send({ name: 'ok' })
      .expect(404);
  });

  it('409 quando o slug colide (não 500)', async () => {
    query.mockReset();
    query.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
    const res = await request(app.getHttpServer())
      .patch('/v1/products/AURUM_X')
      .set(admin)
      .send({ slug: 'aurum-pro' })
      .expect(409);
    expect(String(res.body.message)).toContain('já está em uso');
  });
});
