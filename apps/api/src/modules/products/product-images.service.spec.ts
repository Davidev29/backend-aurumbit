import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NotFoundException } from '@nestjs/common';
import {
  MAX_IMAGE_BYTES,
  ProductImagesService,
  assertValidImage,
  extensionFor,
} from './product-images.service';
import { PRODUCTS_POOL } from './products-pool.provider';

describe('extensionFor/assertValidImage (upload: image/* até 5MB)', () => {
  it('aceita mimes da allowlist com a extensão correta', () => {
    expect(extensionFor('image/png')).toBe('.png');
    expect(extensionFor('image/jpeg')).toBe('.jpg');
    expect(extensionFor('image/webp')).toBe('.webp');
    expect(extensionFor('IMAGE/PNG')).toBe('.png');
  });

  it('rejeita não-imagem e image/* fora da allowlist', () => {
    expect(extensionFor('text/plain')).toBeNull();
    expect(extensionFor('application/pdf')).toBeNull();
    expect(extensionFor('image/tiff')).toBeNull();
    expect(extensionFor('')).toBeNull();
    expect(
      assertValidImage.bind(null, {
        originalname: 'a.pdf',
        mimetype: 'application/pdf',
        size: 10,
        buffer: Buffer.from([1]),
      }),
    ).toThrow(/apenas image/);
  });

  it('rejeita vazio e acima de 5MB', () => {
    const png = { originalname: 'a.png', mimetype: 'image/png' } as const;
    expect(() =>
      assertValidImage({ ...png, size: 0, buffer: Buffer.alloc(0) }),
    ).toThrow(/vazio|ausente/);
    expect(() =>
      assertValidImage({ ...png, size: MAX_IMAGE_BYTES + 1, buffer: Buffer.alloc(1) }),
    ).toThrow(/5MB/);
    expect(
      assertValidImage({ ...png, size: 4, buffer: Buffer.from([137, 80, 78, 71]) }),
    ).toBe('.png');
  });
});

describe('ProductImagesService (disco + metadados)', () => {
  let dir: string;
  let query: jest.Mock;
  let svc: ProductImagesService;
  const prevDir = process.env.PRODUCT_IMAGES_DIR;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prodimg-'));
    process.env.PRODUCT_IMAGES_DIR = dir;
    query = jest.fn();
    svc = new ProductImagesService({ query } as unknown as never);
    // PRODUCTS_POOL token usado só p/ documentar a injeção real:
    expect(PRODUCTS_POOL).toBe('PRODUCTS_POOL');
  });

  afterEach(async () => {
    if (prevDir === undefined) delete process.env.PRODUCT_IMAGES_DIR;
    else process.env.PRODUCT_IMAGES_DIR = prevDir;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const pngFile = () => ({
    originalname: 'foto.png',
    mimetype: 'image/png',
    size: 4,
    buffer: Buffer.from([137, 80, 78, 71]),
  });

  it('save → arquivo `uuid+ext` no disco + linha; list monta url', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'prod-1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'img-1',
            filename: 'uuid-fake.png',
            originalName: 'foto.png',
            mime: 'image/png',
            size_bytes: 4,
            createdAt: new Date('2026-10-11T00:00:00.000Z'),
          },
        ],
      });
    // Força o filename do service p/ couvert determinístico via mock do INSERT:
    const saved = await svc.saveImage('AURUM_X', pngFile());
    expect(saved.url).toBe('/v1/product-images/uuid-fake.png');
    const onDisk = await fs.readdir(dir);
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]).toMatch(/^[0-9a-f-]{36}\.png$/);
    const bytes = await fs.readFile(path.join(dir, onDisk[0]));
    expect(bytes).toEqual(pngFile().buffer);
  });

  it('save apaga o byte se o INSERT falhar', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'prod-1' }] })
      .mockRejectedValueOnce(new Error('db down'));
    await expect(svc.saveImage('AURUM_X', pngFile())).rejects.toThrow('db down');
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('remove: 404 se inexistente; existente apaga linha + arquivo', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(svc.removeImage('NOPE', 'img-x')).rejects.toBeInstanceOf(NotFoundException);

    const filename = 'del-me.png';
    await fs.writeFile(path.join(dir, filename), Buffer.from([1, 2]));
    query
      .mockResolvedValueOnce({ rows: [{ id: 'prod-1' }] })
      .mockResolvedValueOnce({ rows: [{ filename }] });
    await expect(svc.removeImage('AURUM_X', 'img-1')).resolves.toEqual({
      id: 'img-1',
      removed: true,
    });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('traversal: `../` e subpaths dão 404 sem tocar no banco', async () => {
    await expect(svc.openImageStream('../secret.png')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.openImageStream('sub/dir.png')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.openImageStream('')).rejects.toBeInstanceOf(NotFoundException);
    expect(query).not.toHaveBeenCalled();
  });

  it('stream: 404 se a linha não existe; 404 se o byte sumiu do disco', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(svc.openImageStream('ghost.png')).rejects.toBeInstanceOf(NotFoundException);

    query.mockResolvedValueOnce({ rows: [{ mime: 'image/png', size_bytes: 4 }] });
    await expect(svc.openImageStream('orphan.png')).rejects.toBeInstanceOf(NotFoundException);
  });
});
