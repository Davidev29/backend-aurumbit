import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { PRODUCT_IMMUTABLE_FIELDS, ReplaceProductDto, UpdateProductDto } from './dto';
import { assertWritableShape, normalizePlatforms, ProductsService } from './products.service';

/**
 * PATCH/PUT de produto (Lane E).
 *
 * Mesma estratégia dos spec's vizinhos (`products-machines.spec.ts` /
 * `products-platforms.spec.ts`): pool `pg` mockado com um único `query` e
 * cada asserção prova algo observável — o SQL enviado, os valores enviados ou
 * o tipo/código do erro. Nenhum mock "passa sem provar": quem chama `query`
 * devolve a linha do produto, e o spec afirma o statement e os parâmetros.
 */

type QueryMock = jest.Mock;

function svcWith(query: QueryMock): ProductsService {
  return new ProductsService({ query } as unknown as never);
}

/** Linha do `RETURNING` (projeção `PRODUCT_COLS` do service). */
function productRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    code: 'AURUM_X',
    name: 'Aurum X',
    slug: 'aurum-x',
    description: 'texto original',
    status: 'ACTIVE',
    machinesAllowed: 3,
    platforms: ['windows'],
    deliveryMode: 'OFFLINE',
    createdAt: new Date('2026-10-17T00:00:00.000Z'),
    updatedAt: new Date('2026-10-17T00:00:00.000Z'),
    ...over,
  };
}

/** UPDATE que responde: 1ª chamada = linha do produto, 2ª/3ª = detalhe. */
function queryResponding(rows: Array<Record<string, unknown>> = [productRow()]): QueryMock {
  return jest
    .fn()
    .mockResolvedValueOnce({ rows })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
}

function sqlOf(query: QueryMock, call = 0): string {
  return String(query.mock.calls[call][0]);
}

function paramsOf(query: QueryMock, call = 0): unknown[] {
  return query.mock.calls[call][1] as unknown[];
}

/** Espelha `main.ts`: whitelist + forbidNonWhitelisted + transform. */
function bodyPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}

const PATCH_META = { type: 'body' as const, metatype: UpdateProductDto };
const PUT_META = { type: 'body' as const, metatype: ReplaceProductDto };

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const response = (e as { getResponse?: () => { message?: unknown } }).getResponse?.();
    const message = response?.message;
    return Array.isArray(message) ? message.join(' | ') : String(message ?? e);
  }
  throw new Error('a promise deveria ter rejeitado');
}

describe('ProductsService PATCH — atualização parcial', () => {
  it('muda SÓ os campos enviados: os ausentes nem aparecem no SET', async () => {
    const query = queryResponding([productRow({ name: 'Aurum X Plus', machinesAllowed: 5 })]);
    const svc = svcWith(query);

    const detail = await svc.updateProduct('AURUM_X', { name: 'Aurum X Plus', machinesAllowed: 5 });

    const sql = sqlOf(query);
    // Colunas do corpo presentes...
    expect(sql).toContain('name = $2');
    expect(sql).toContain('machines_allowed = $3');
    // ...e as ausentes NÃO (slug/description/platforms/delivery_mode intactos).
    expect(sql).not.toContain('slug =');
    expect(sql).not.toContain('description =');
    expect(sql).not.toContain('platforms =');
    expect(sql).not.toContain('delivery_mode =');
    // Valores: na ordem da LISTA BRANVA, nunca na ordem do JSON do cliente.
    expect(paramsOf(query)).toEqual(['AURUM_X', 'Aurum X Plus', 5]);
    expect(detail.name).toBe('Aurum X Plus');
    expect(detail.machinesAllowed).toBe(5);
  });

  it('é idempotente: 2 execuções do mesmo corpo → mesmo estado e mesmo SQL', async () => {
    const first = queryResponding([productRow({ description: null })]);
    await svcWith(first).updateProduct('AURUM_X', { description: null });

    const second = queryResponding([productRow({ description: null })]);
    await svcWith(second).updateProduct('AURUM_X', { description: null });

    expect(sqlOf(second)).toBe(sqlOf(first));
    expect(paramsOf(second)).toEqual(paramsOf(first));
    // `description: null` limpa MESMO (chave presente não é "ausente").
    expect(sqlOf(second)).toContain('description = $2');
    expect(paramsOf(second)).toEqual(['AURUM_X', null]);
  });

  it('preserva a descrição quando o PATCH não a menciona (PUT zera; PATCH não)', async () => {
    const patch = queryResponding();
    await svcWith(patch).updateProduct('AURUM_X', { machinesAllowed: 7 });
    expect(sqlOf(patch)).not.toContain('description =');

    const put = queryResponding([productRow({ description: null })]);
    await svcWith(put).replaceProduct('AURUM_X', {
      name: 'Aurum X',
      slug: 'aurum-x',
      description: null,
      machinesAllowed: 3,
      platforms: ['windows'],
      deliveryMode: 'OFFLINE',
    });
    expect(sqlOf(put)).toContain('description = $4');
    expect(paramsOf(put)).toEqual(['AURUM_X', 'Aurum X', 'aurum-x', null, 3, ['windows'], 'OFFLINE']);
  });

  it('body vazio (ou só campos proibidos) → 400 e o banco NÃO é tocado', async () => {
    const query = jest.fn();
    const svc = svcWith(query);

    await expect(svc.updateProduct('AURUM_X', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(await messageOf(svc.updateProduct('AURUM_X', {}))).toContain('Nada a alterar');
    expect(query).not.toHaveBeenCalled();
  });

  it('code/status/preço no body → recusado COM O MOTIVO, sem tocar o banco', async () => {
    const query = jest.fn();
    const svc = svcWith(query);

    for (const [field, value] of [
      ['code', 'AURUM_Y'],
      ['status', 'ARCHIVED'],
      ['priceCents', 1000],
      ['monthlyPriceCents', 1000],
      ['annualPriceCents', 1000],
    ] as const) {
      await expect(svc.updateProduct('AURUM_X', { [field]: value })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      const msg = await messageOf(svc.updateProduct('AURUM_X', { [field]: value }));
      expect(msg).toBe(PRODUCT_IMMUTABLE_FIELDS[field]);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('`code` imutável: a mensagem aponta o caminho certo (novo produto, não patch)', async () => {
    const svc = svcWith(jest.fn());
    const msg = await messageOf(svc.updateProduct('AURUM_X', { code: 'OUTRO' } as never));
    expect(msg).toContain('crie um produto novo');
    expect(msg).toContain('licenças');
  });

  it('404 quando o code não existe (UPDATE não casou) e nada mais é executado', async () => {
    const query = queryResponding([]);
    await expect(svcWith(query).updateProduct('NAO_EXISTE', { name: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // A composição do detalhe (versões/imagens) não roda para produto inexistente.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('409 (não 500) quando o slug colide com outro produto', async () => {
    const query = jest.fn().mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
    const svc = svcWith(query);

    await expect(svc.updateProduct('AURUM_X', { slug: 'aurum-pro' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await messageOf(svc.updateProduct('AURUM_X', { slug: 'aurum-pro' }))).toContain(
      'slug "aurum-pro" já está em uso',
    );
  });

  it('erro de banco que não é 23505 sobe intacto (não vira 409 enganoso)', async () => {
    const boom = new Error('deadlock');
    const svc = svcWith(jest.fn().mockRejectedValue(boom));
    await expect(svc.updateProduct('AURUM_X', { name: 'X' })).rejects.toBe(boom);
  });

  it('validação fail-closed: plataforma/slug/entrega/machines inválidos não chegam ao SQL', async () => {
    const svc = svcWith(jest.fn());
    await expect(
      svc.updateProduct('AURUM_X', { platforms: ['windows', 'android'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateProduct('AURUM_X', { slug: 'Aurum Pro' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(svc.updateProduct('AURUM_X', { slug: 'aurum--pro' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(svc.updateProduct('AURUM_X', { slug: 'aurum_pro' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('platforms é normalizado (ordem canônica) ANTES do statement', async () => {
    const query = queryResponding();
    await svcWith(query).updateProduct('AURUM_X', { platforms: ['web', 'windows', 'windows'] });
    expect(sqlOf(query)).toContain('platforms = $2::text[]');
    expect(paramsOf(query)[1]).toEqual(['windows', 'web']);
    expect(normalizePlatforms(['web', 'windows', 'windows'])).toEqual(['windows', 'web']);
  });

  it('`platforms: []` limpa a lista (não é rejeitado) e `platforms: null` é erro', async () => {
    const clear = queryResponding();
    await svcWith(clear).updateProduct('AURUM_X', { platforms: [] });
    expect(paramsOf(clear)[1]).toEqual([]);

    const svc = svcWith(jest.fn());
    await expect(
      svc.updateProduct('AURUM_X', { platforms: null as never }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('`machinesAllowed: null` é erro (coluna NOT NULL), não "apaga a coluna"', async () => {
    const svc = svcWith(jest.fn());
    await expect(
      svc.updateProduct('AURUM_X', { machinesAllowed: null as never }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('grava em 1 statement de escrita (sem SELECT-then-UPDATE) e monta o detalhe', async () => {
    const query = queryResponding([productRow({ name: 'Y' })]);
    await svcWith(query).updateProduct('AURUM_X', { name: 'Y' });

    const sqls = query.mock.calls.map((c) => String(c[0]));
    const updates = sqls.filter((s) => s.includes('UPDATE products'));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/^UPDATE products SET .* WHERE code = \$1 RETURNING /);
    expect(sqls.some((s) => s.startsWith('SELECT') && s.includes('FROM products WHERE code'))).toBe(false);
    // 3 calls fixas: 1 UPDATE + 1 versões + 1 imagens (nunca por campo/campo).
    expect(query).toHaveBeenCalledTimes(3);
  });
});

describe('ProductsService PUT — substituição total', () => {
  const full = {
    name: 'Aurum X',
    slug: 'aurum-x',
    description: 'texto',
    machinesAllowed: 3,
    platforms: ['windows'],
    deliveryMode: 'OFFLINE',
  };

  it('grava todos os campos de uma vez', async () => {
    const query = queryResponding();
    await svcWith(query).replaceProduct('AURUM_X', { ...full, description: "d'água" });
    expect(sqlOf(query)).toBe(
      'UPDATE products SET name = $2, slug = $3, description = $4, machines_allowed = $5, ' +
        'platforms = $6::text[], delivery_mode = $7, "updatedAt" = now() WHERE code = $1 RETURNING ' +
        'id, code, name, slug, description, status, machines_allowed AS "machinesAllowed",' +
        '\n  platforms, delivery_mode AS "deliveryMode", "createdAt", "updatedAt"',
    );
    expect(paramsOf(query)).toEqual([
      'AURUM_X',
      'Aurum X',
      'aurum-x',
      "d'água",
      3,
      ['windows'],
      'OFFLINE',
    ]);
  });

  it('falta 1 campo → 400 listando o que falta, sem tocar o banco', async () => {
    const { deliveryMode: _omitted, ...rest } = full;
    const query = jest.fn();
    const svc = svcWith(query);

    const msg = await messageOf(svc.replaceProduct('AURUM_X', rest));
    expect(msg).toContain('Faltam: deliveryMode');
    expect(msg).toContain('PUT');
    await expect(svc.replaceProduct('AURUM_X', rest)).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('PUT sem NENHUM campo → 400 (não "sucesso" com tudo intacto)', async () => {
    const svc = svcWith(jest.fn());
    const msg = await messageOf(svc.replaceProduct('AURUM_X', {}));
    expect(msg).toContain('Faltam');
  });

  it('`description: null` explícito ZERA (a diferença em relação ao PATCH)', async () => {
    const query = queryResponding([productRow({ description: null })]);
    const detail = await svcWith(query).replaceProduct('AURUM_X', { ...full, description: null });
    expect(sqlOf(query)).toContain('description = $4');
    expect(paramsOf(query)[3]).toBeNull();
    expect(detail.description).toBeNull();
  });

  it('mesmas travas do PATCH: code/status/preço, plataformas e slug', async () => {
    const svc = svcWith(jest.fn());
    await expect(
      svc.replaceProduct('AURUM_X', { ...full, code: 'NOVO' } as never),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      svc.replaceProduct('AURUM_X', { ...full, status: 'DRAFT' } as never),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      svc.replaceProduct('AURUM_X', { ...full, platforms: ['android'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 para code inexistente', async () => {
    const query = queryResponding([]);
    await expect(svcWith(query).replaceProduct('NAO_EXISTE', full)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('409 quando o slug novo pertence a outro produto', async () => {
    const query = jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(
      svcWith(query).replaceProduct('AURUM_X', { ...full, slug: 'outro' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('Lista branca — o corpo do cliente NUNCA vira nome de coluna', () => {
  it('chave estranha é recusada (422), não ignorada em silêncio', async () => {
    const svc = svcWith(jest.fn());
    const msg = await messageOf(
      svc.updateProduct('AURUM_X', { name: 'ok', tags: ['x'] } as never),
    );
    expect(msg).toContain('O campo "tags" não pode ser editado');
    expect(msg).toContain('name, slug, description, machinesAllowed, platforms, deliveryMode');
  });

  it('`__proto__` e `constructor` no corpo não viram coluna nem polymorphismo', async () => {
    const svc = svcWith(jest.fn());
    // `JSON.parse` cria a própria chave `__proto__` (ao contrário de literal).
    const hostile = JSON.parse('{"name":"ok","__proto__":{"polluted":true}}') as Record<string, unknown>;
    await expect(svc.updateProduct('AURUM_X', hostile as never)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    await expect(
      svc.updateProduct('AURUM_X', JSON.parse('{"constructor":"x"}')),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('o statement só contém colunas da LISTA BRANVA, mesmo com o body poluído', async () => {
    const query = queryResponding();
    const hostile = JSON.parse(
      '{"machinesAllowed":4,"platforms":["windows"],"machines_allowed":999,"name; DROP TABLE products":"x"}',
    ) as Record<string, unknown>;
    await expect(svcWith(query).updateProduct('AURUM_X', hostile as never)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(query).not.toHaveBeenCalled();

    // Com corpo limpo, o SQL tem só as colunas da lista branca:
    const ok = queryResponding();
    await svcWith(ok).updateProduct('AURUM_X', { machinesAllowed: 4, platforms: ['windows'] });
    const sql = sqlOf(ok);
    expect(sql).toBe(
      'UPDATE products SET machines_allowed = $2, platforms = $3::text[], "updatedAt" = now() ' +
        'WHERE code = $1 RETURNING ' +
        'id, code, name, slug, description, status, machines_allowed AS "machinesAllowed",' +
        '\n  platforms, delivery_mode AS "deliveryMode", "createdAt", "updatedAt"',
    );
    expect(sql).not.toContain('DROP');
    expect(sql).not.toContain('$1, $2;');
  });

  it('corpo que não é objeto JSON → 400', () => {
    expect(() => assertWritableShape("name='x'")).toThrow(BadRequestException);
    expect(() => assertWritableShape(null)).toThrow(BadRequestException);
    expect(() => assertWritableShape([])).toThrow(BadRequestException);
  });

  /**
   * REGRA F-15 (rev. 2026-10-17): `platforms: []` é VÁLIDO no PATCH e
   * INVÁLIDO no PUT. Antes desta regra o Nest acebia `[]` nos dois verbos e a
   * BFF admin recusava nos dois — duas políticas opostas para o mesmo dado.
   * Estes testes existem para travar a divergência: se alguém voltar a
   * aceitar `[]` no PUT (ou recusar no PATCH), o teste falha.
   */
  describe('F-15: lista vazia de plataformas por verbo', () => {
    it('PATCH com platforms: [] GRAVA a lista vazia (limpeza legítima)', async () => {
      // O `RETURNING` reflete o que foi gravado: lista vazia.
      const query = queryResponding([productRow({ platforms: [] })]);
      const out = await svcWith(query).updateProduct('AURUM_X', { platforms: [] });
      // O banco realmente recebeu a lista vazia como valor do placeholder.
      expect(query).toHaveBeenCalled();
      const params = query.mock.calls[0][1] as unknown[];
      expect(params).toEqual(['AURUM_X', []]);
      expect(sqlOf(query)).toContain('platforms = $2::text[]');
      expect(out.platforms).toEqual([]);
    });

    it('PATCH com platforms: [] é idempotente (2ª chamada = mesmo estado)', async () => {
      const first = await svcWith(queryResponding([productRow({ platforms: [] })])).updateProduct(
        'AURUM_X',
        { platforms: [] },
      );
      const second = await svcWith(queryResponding([productRow({ platforms: [] })])).updateProduct(
        'AURUM_X',
        { platforms: [] },
      );
      expect(first.platforms).toEqual(second.platforms);
      expect(first.platforms).toEqual([]);
    });

    it('PUT com platforms: [] é RECUSADO e o banco não é tocado', async () => {
      const query = queryResponding();
      await expect(
        svcWith(query).replaceProduct('AURUM_X', {
          name: 'Aurum X',
          slug: 'aurum-x',
          description: 'texto',
          machinesAllowed: 3,
          platforms: [],
          deliveryMode: 'OFFLINE',
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(query).not.toHaveBeenCalled();
    });

    it('a mensagem do PUT manda usar o PATCH (caminho correto, não erro opaco)', async () => {
      const err = await svcWith(queryResponding())
        .replaceProduct('AURUM_X', {
          name: 'Aurum X',
          slug: 'aurum-x',
          description: 'texto',
          machinesAllowed: 3,
          platforms: [],
          deliveryMode: 'OFFLINE',
        })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(String((err as Error).message)).toContain('PATCH');
      expect(String((err as Error).message)).toContain('plataforma');
    });

    it('PUT com 1 plataforma continua aceito (não regrediu a validação)', async () => {
      const query = queryResponding();
      const out = await svcWith(query).replaceProduct('AURUM_X', {
        name: 'Aurum X',
        slug: 'aurum-x',
        description: 'texto',
        machinesAllowed: 3,
        platforms: ['windows'],
        deliveryMode: 'OFFLINE',
      });
      expect(out.platforms).toEqual(['windows']);
      expect(query.mock.calls[0][1]).toContainEqual(['windows']);
    });

    it('PATCH que NÃO toca platforms preserva as existentes (não zera por acidente)', async () => {
      const query = queryResponding();
      await svcWith(query).updateProduct('AURUM_X', { name: 'Outro nome' });
      const sql = sqlOf(query);
      expect(sql).not.toContain('platforms =');
      expect(query.mock.calls[0][1]).toEqual(['AURUM_X', 'Outro nome']);
    });

    it('a mensagem de `null` em platforms aponta o caminho do PATCH', async () => {
      const err = await svcWith(queryResponding())
        .updateProduct('AURUM_X', { platforms: null as unknown as string[] })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(String((err as Error).message)).toContain('PATCH');
    });
  });
});

describe('DTO + ValidationPipe real (o mesmo pipe global de main.ts)', () => {
  it('PATCH aceita update parcial e preserva o que não veio', async () => {
    const dto = await bodyPipe().transform({ name: 'Novo nome' }, PATCH_META);
    expect((dto as UpdateProductDto).name).toBe('Novo nome');
    expect((dto as UpdateProductDto).slug).toBeUndefined();
  });

  it('PATCH recusa code/status/preço com o motivo (não o genérico do forbid)', async () => {
    for (const [field, value] of [
      ['code', 'OUTRO'],
      ['status', 'ARCHIVED'],
      ['priceCents', 100],
    ] as const) {
      const err = await bodyPipe()
        .transform({ name: 'ok', [field]: value }, PATCH_META)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(await messageOf(Promise.reject(err))).toContain(PRODUCT_IMMUTABLE_FIELDS[field]);
    }
  });

  it('PUT com o corpo completo passa; PUT com `code` falha com o motivo', async () => {
    const ok = await bodyPipe().transform(
      {
        name: 'Aurum X',
        slug: 'aurum-x',
        description: null,
        machinesAllowed: 4,
        platforms: ['web', 'windows'],
        deliveryMode: 'HYBRID',
      },
      PUT_META,
    );
    expect((ok as ReplaceProductDto).deliveryMode).toBe('HYBRID');
    expect((ok as ReplaceProductDto).description).toBeNull();

    await expect(
      bodyPipe().transform({ name: 'ok', code: 'NOVO' }, PUT_META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validação fail-closed no pipe: plataforma/deliveryMode/slug/machines fora da faixa', async () => {
    await expect(
      bodyPipe().transform({ platforms: ['Windows'] }, PATCH_META),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      bodyPipe().transform({ platforms: ['android'] }, PATCH_META),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      bodyPipe().transform({ deliveryMode: 'STREAMING' }, PATCH_META),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      bodyPipe().transform({ slug: 'Aurum Pro' }, PATCH_META),
    ).rejects.toBeInstanceOf(BadRequestException);
    for (const machinesAllowed of [0, 101, 2.5]) {
      await expect(
        bodyPipe().transform({ machinesAllowed }, PATCH_META),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('campo fora do catálogo é barrado pelo forbidNonWhitelisted', async () => {
    await expect(
      bodyPipe().transform({ name: 'ok', tags: ['a'] }, PATCH_META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
