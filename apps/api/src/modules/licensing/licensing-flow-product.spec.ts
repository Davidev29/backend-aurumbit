import { NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { InMemoryLicenseStore } from './license-store';
import { LicensingFlowService } from './licensing-flow.service';

const PAID_AT = '2026-01-01T00:00:00.000Z';

function setup() {
  const store = new InMemoryLicenseStore();
  const audit = new AuditService();
  const flow = new LicensingFlowService(store, audit);
  return { store, audit, flow };
}

describe('LicensingFlow ownerLabel (flow in-memory)', () => {
  it('issue persiste ownerLabel no record e expõe no by-product', async () => {
    const { store, flow } = setup();
    const issued = await flow.issue({
      ownerId: 'cus-1',
      ownerLabel: 'Acme LTDA',
      productId: 'AURUM_TERMINAL',
      months: 1,
      paidAt: PAID_AT,
      actor: 'tester',
    });
    expect(issued.id).toBeDefined();
    expect(store.get(issued.id)?.ownerLabel).toBe('Acme LTDA');

    const rows = flow.listByProduct('AURUM_TERMINAL');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ownerId: 'cus-1',
      ownerLabel: 'Acme LTDA',
      productId: 'AURUM_TERMINAL',
      machinesAllowed: 5,
      machinesUsed: 0,
    });
    expect(rows[0].keyMasked).toMatch(/^AURUM-••••-••••-/);
    expect(rows[0]).not.toHaveProperty('key');
  });

  it('ownerLabel omitido → null; by-product filtra por produto', async () => {
    const { flow } = setup();
    await flow.issue({ ownerId: 'a', productId: 'P1', months: 1, paidAt: PAID_AT });
    await flow.issue({ ownerId: 'b', productId: 'P2', months: 12, paidAt: PAID_AT });
    expect(flow.listByProduct('P1')).toHaveLength(1);
    expect(flow.listByProduct('P1')[0].ownerLabel).toBeNull();
    expect(flow.listByProduct('P9')).toEqual([]);
  });
});

describe('LicensingFlow revoke com replacedBy', () => {
  it('vai p/ o metadata do audit license.revoke e p/ o history', async () => {
    const { audit, flow } = setup();
    const issued = await flow.issue({ ownerId: 'cus-2', productId: 'P1', months: 1, paidAt: PAID_AT });
    await flow.revoke(issued.id, {
      actor: 'tester',
      reason: 'renovação com substituição',
      replacedBy: 'new-lic-id',
    });

    const evs = audit.listByEntity('license', issued.id).filter((e) => e.action === 'license.revoke');
    expect(evs).toHaveLength(1);
    expect(evs[0].metadata).toMatchObject({ reason: 'renovação com substituição', replacedBy: 'new-lic-id' });

    const history = flow.getHistory(issued.id);
    const revoked = history.find((h) => h.status === 'revoked');
    expect(revoked).toMatchObject({ licenseId: issued.id, replacedBy: 'new-lic-id' });
    expect(typeof revoked?.endedAt).toBe('string');
  });

  it('revoke sem replacedBy mantém metadata sem a chave', async () => {
    const { audit, flow } = setup();
    const issued = await flow.issue({ ownerId: 'cus-3', productId: 'P1', months: 1, paidAt: PAID_AT });
    await flow.revoke(issued.id, { actor: 'tester', reason: 'fraude confirmada' });
    const evs = audit.listByEntity('license', issued.id).filter((e) => e.action === 'license.revoke');
    expect(evs[0].metadata).not.toHaveProperty('replacedBy');
  });
});

describe('LicensingFlow history (audit in-memory)', () => {
  it('cobre issue/renew/revoke/reveal com as chaves exatas', async () => {
    const { flow } = setup();
    const issued = await flow.issue({
      ownerId: 'cus-4',
      productId: 'P1',
      months: 1,
      paidAt: PAID_AT,
      actor: 'tester',
    });
    await flow.renew(issued.id, { now: '2026-02-02T00:00:00.000Z', actor: 'tester' });
    await flow.reveal(issued.id, { actor: 'tester', reason: 'suporte ao titular' });
    await flow.revoke(issued.id, { actor: 'tester', reason: 'fim do contrato agora', replacedBy: 'lic-new' });

    const history = flow.getHistory(issued.id);
    expect(history.length).toBeGreaterThanOrEqual(4);
    for (const h of history) {
      expect(Object.keys(h).sort()).toEqual(
        ['endedAt', 'keyMasked', 'licenseId', 'reason', 'replacedBy', 'status'].sort(),
      );
      expect(h.licenseId).toBe(issued.id);
    }
    const byStatus = history.map((h) => h.status);
    expect(byStatus).toContain('active');
    expect(byStatus).toContain('revoked');
    const active = history.find((h) => h.status === 'active');
    expect(active?.endedAt).toBeNull();
    expect(active?.replacedBy).toBeNull();
  });

  it('licença inexistente → 404', () => {
    const { flow } = setup();
    expect(() => flow.getHistory('missing')).toThrow(NotFoundException);
  });
});
