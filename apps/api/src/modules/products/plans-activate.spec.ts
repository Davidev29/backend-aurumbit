import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlansService } from './plans.service';

function planRow(over: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    code: 'TERMINAL_PRO_MONTHLY',
    name: 'Terminal Pro Mensal',
    priceCents: 9900,
    billingInterval: 'MONTH',
    validFrom: new Date('2026-10-01T00:00:00.000Z'),
    validTo: null,
    status: 'DRAFT',
    supersededBy: null,
    productCode: 'AURUM_TERMINAL',
    ...over,
  };
}

describe('PlansService.activatePlan (idempotente)', () => {
  it('DRAFT → ACTIVE responde a linha; 2ª chamada (ACTIVE) sem erro', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'plan-1' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [planRow({ status: 'ACTIVE' })] }) // SELECT view
      .mockResolvedValueOnce({ rows: [] }) // features
      .mockResolvedValueOnce({ rows: [{ id: 'plan-1' }] }) // UPDATE (2ª)
      .mockResolvedValueOnce({ rows: [planRow({ status: 'ACTIVE' })] })
      .mockResolvedValueOnce({ rows: [] });
    const svc = new PlansService({ query } as unknown as never);

    const first = await svc.activatePlan('plan-1');
    expect(first.status).toBe('ACTIVE');
    expect(first.id).toBe('plan-1');

    const second = await svc.activatePlan('plan-1');
    expect(second.status).toBe('ACTIVE');
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('inexistente → 404', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // UPDATE nada
      .mockResolvedValueOnce({ rows: [] }); // SELECT id nada
    const svc = new PlansService({ query } as unknown as never);
    await expect(svc.activatePlan('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('arquivado → 409 (imutabilidade: linha fechada não reativa)', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // UPDATE nada (status ARCHIVED)
      .mockResolvedValueOnce({ rows: [{ id: 'plan-1' }] }); // existe, mas arquivado
    const svc = new PlansService({ query } as unknown as never);
    await expect(svc.activatePlan('plan-1')).rejects.toBeInstanceOf(ConflictException);
  });
});
