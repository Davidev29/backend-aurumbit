import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateProductDto } from './dto';
import { normalizePlatforms, ProductsService } from './products.service';

// Pool mockado no mesmo padrão de products-machines.spec.ts: só `query` é
// exercitado, e cada assert prova algo observável (SQL enviado ou valor
// persistido) — nada de mock que "passa sem provar".
function svcWith(query: jest.Mock): ProductsService {
  return new ProductsService({ query } as unknown as never);
}

function productRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
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
    ...over,
  };
}

// Espelha `main.ts`: whitelist + forbidNonWhitelisted + transform. É o mesmo
// pipe global que valida `POST /v1/products` — provar aqui prova o bug real.
function bodyPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}
const BODY_META = { type: 'body' as const, metatype: CreateProductDto };

describe('ProductsService platforms + deliveryMode', () => {
  it('normaliza platforms: dedup, trim e ordem CANÔNICA do catálogo (não a de chegada)', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [productRow()] });
    const svc = svcWith(query);

    await svc.createProduct({
      code: 'AURUM_X',
      name: 'Aurum X',
      slug: 'aurum-x',
      // fora de ordem, com repetição e com espaço: web, windows, linux, windows
      platforms: ['web', 'windows', 'linux', 'windows'],
    });

    const [sql, params] = query.mock.calls[0];
    // Ordem canônica = windows, macos, linux, web, apple (PRODUCT_PLATFORM_IDS).
    expect(params[7]).toEqual(['windows', 'linux', 'web']);
    expect(String(sql)).toContain('platforms');
    expect(String(sql)).toContain('$8::text[]');
  });

  it('trim normaliza slug com espaço e dedup mantém um só exemplar', () => {
    expect(normalizePlatforms([' macos ', 'macos', 'apple'])).toEqual(['macos', 'apple']);
  });

  it('deliveryMode: OFFLINE é o default quando omitido; HYBRID é persistido quando enviado', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [productRow()] });
    const svc = svcWith(query);

    await svc.createProduct({ code: 'AURUM_X', name: 'Aurum X', slug: 'aurum-x' });

    const [sql, params] = query.mock.calls[0];
    expect(params[8]).toBeNull(); // COALESCE no SQL -> default do banco
    expect(String(sql)).toContain('delivery_mode');
    expect(String(sql)).toContain("COALESCE($9, 'OFFLINE')");

    query.mockClear();
    await svc.createProduct({
      code: 'AURUM_X',
      name: 'Aurum X',
      slug: 'aurum-x',
      deliveryMode: 'HYBRID',
    });
    expect(query.mock.calls[0][1][8]).toBe('HYBRID');
  });

  it('slug fora do catálogo é rejeitado (fail-closed) e NUNCA chega ao INSERT', async () => {
    const query = jest.fn();
    const svc = svcWith(query);

    await expect(
      svc.createProduct({
        code: 'AURUM_X',
        name: 'Aurum X',
        slug: 'aurum-x',
        platforms: ['windows', 'android'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Prova do fail-closed: banco intocado (nada "aceito e ignorado").
    expect(query).not.toHaveBeenCalled();
  });

  it('SELECT traz platforms + deliveryMode (mesma projeção das leituras)', async () => {
    const query = jest.fn();
    const svc = svcWith(query);

    query.mockResolvedValueOnce({ rows: [productRow({ platforms: ['windows', 'web'], deliveryMode: 'HYBRID' })] });
    const listed = await svc.listProducts();
    expect(listed[0].platforms).toEqual(['windows', 'web']);
    expect(listed[0].deliveryMode).toBe('HYBRID');
    expect(String(query.mock.calls[0][0])).toContain('delivery_mode AS "deliveryMode"');

    query
      .mockResolvedValueOnce({ rows: [productRow({ platforms: ['apple'], deliveryMode: 'HYBRID' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const detail = await svc.getProduct('AURUM_X');
    expect(detail.platforms).toEqual(['apple']);
    expect(detail.deliveryMode).toBe('HYBRID');
  });
});

describe('CreateProductDto platforms + deliveryMode (ValidationPipe real)', () => {
  const base = { code: 'AURUM_X', name: 'Aurum X', slug: 'aurum-x' };

  it('aceita as 5 plataformas do catálogo, com dedup no service', async () => {
    const dto = await bodyPipe().transform({ ...base, platforms: ['apple', 'web', 'linux', 'macos', 'windows'] }, BODY_META);
    expect((dto as CreateProductDto).platforms).toEqual(['apple', 'web', 'linux', 'macos', 'windows']);
  });

  it('rejeita slug desconhecido com 400 (BadRequestException)', async () => {
    await expect(
      bodyPipe().transform({ ...base, platforms: ['windows', 'android'] }, BODY_META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita slug com caixa alta (o catálogo é minúsculo e fail-closed)', async () => {
    await expect(
      bodyPipe().transform({ ...base, platforms: ['Windows'] }, BODY_META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita deliveryMode fora de OFFLINE|HYBRID', async () => {
    await expect(
      bodyPipe().transform({ ...base, deliveryMode: 'STREAMING' }, BODY_META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('omite os dois campos sem quebrar criação (back-compat de payload antigo)', async () => {
    const dto = await bodyPipe().transform({ ...base }, BODY_META);
    expect((dto as CreateProductDto).platforms).toBeUndefined();
    expect((dto as CreateProductDto).deliveryMode).toBeUndefined();
  });
});
