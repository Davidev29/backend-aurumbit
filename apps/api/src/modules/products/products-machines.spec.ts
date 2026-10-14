import { ProductsService } from './products.service';

describe('ProductsService machinesAllowed + images', () => {
  it('create/list/get retornam machinesAllowed; get inclui images com url', async () => {
    const query = jest.fn();
    const svc = new ProductsService({ query } as unknown as never);

    query.mockResolvedValueOnce({
      rows: [
        {
          id: 'p1',
          code: 'AURUM_X',
          name: 'Aurum X',
          slug: 'aurum-x',
          description: null,
          status: 'ACTIVE',
          machinesAllowed: 7,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    const created = await svc.createProduct({
      code: 'AURUM_X',
      name: 'Aurum X',
      slug: 'aurum-x',
      machinesAllowed: 7,
    });
    expect(created.machinesAllowed).toBe(7);
    // INSERT leva machines_allowed (default 3 via COALESCE quando omitido).
    expect(String(query.mock.calls[0][0])).toContain('machines_allowed');

    query.mockResolvedValueOnce({ rows: [{ ...created }] });
    const listed = await svc.listProducts();
    expect(listed[0].machinesAllowed).toBe(7);

    query
      .mockResolvedValueOnce({ rows: [{ ...created }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'img-1',
            filename: 'u.png',
            originalName: 'u.png',
            mime: 'image/png',
            size_bytes: 12,
            createdAt: new Date('2026-10-11T00:00:00.000Z'),
          },
        ],
      });
    const detail = await svc.getProduct('AURUM_X');
    expect(detail.machinesAllowed).toBe(7);
    expect(detail.images).toEqual([
      {
        id: 'img-1',
        filename: 'u.png',
        originalName: 'u.png',
        mime: 'image/png',
        size: 12,
        url: '/v1/product-images/u.png',
        createdAt: new Date('2026-10-11T00:00:00.000Z'),
      },
    ]);
  });
});
