import { LicensingSyncService, SqlRunner } from './sync.service';
import {
  CascadeInput,
  cascadeEventId,
  entitlementUpsertsFor,
  featureCodesFor,
  grantIdempotencyKey,
  jobIdForEvent,
  kindForTopic,
  parseLicenseEnvelope,
  planRevocationCascade,
} from './sync.transitions';

const NOW = new Date('2026-10-10T12:00:00.000Z');

function issued(payload: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: 'evt-issued-0001',
    topic: 'licensing.license.issued.v1',
    version: 1,
    occurredAt: '2026-10-10T12:00:00.000Z',
    payload: {
      licenseId: 'lic-1',
      ownerId: 'cust-1',
      productId: 'prod-1',
      featureCode: 'F1',
      startsAt: '2026-10-10T12:00:00.000Z',
      expiresAt: '2026-11-10T12:00:00.000Z',
      ...payload,
    },
  };
}

describe('parseLicenseEnvelope', () => {
  it('aceita issued válido e ignora campos extras', () => {
    const r = parseLicenseEnvelope({ ...issued(), correlationId: 'x', payload: { ...(issued().payload as object), futuro: 1 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('issued');
  });
  it.each([
    ['topic desconhecido', { ...issued(), topic: 'nada.v1' }],
    ['eventId curto', { ...issued(), eventId: 'abc' }],
    ['sem licenseId', issued({ licenseId: undefined })],
    ['issued sem owner', issued({ ownerId: undefined })],
    ['occurredAt inválido', { ...issued(), occurredAt: 'ontem' }],
    ['não-objeto', 42],
  ])('rejeita: %s', (_name, raw) => {
    expect(parseLicenseEnvelope(raw).ok).toBe(false);
  });
  it('mapeia tópicos suspenso/unlinked/device', () => {
    expect(kindForTopic('licensing.license.suspended.v1')).toBe('suspended');
    expect(kindForTopic('licensing.device.unlinked.v1')).toBe('device-unlinked');
    expect(kindForTopic('licensing.device.clone_suspect.v1')).toBe('clone-suspect');
    expect(kindForTopic('licensing.device.linked.v1')).toBe('device-linked');
    expect(kindForTopic('outro.v1')).toBeNull();
  });
});

describe('featureCodesFor', () => {
  it('prioridade: featureCode > lista dedupada > curinga', () => {
    expect(featureCodesFor({ featureCode: 'F1' })).toEqual({ codes: ['F1'], wildcard: false });
    expect(featureCodesFor({ featureCodes: ['F1', 'F2', 'F1', ''] })).toEqual({ codes: ['F1', 'F2'], wildcard: false });
    expect(featureCodesFor({})).toEqual({ codes: ['*'], wildcard: true });
  });
});

describe('Fase 8: origin/channel por kind (entitlementUpsertsFor)', () => {
  const base = (kind?: string) =>
    issued({ kind, featureCode: undefined, featureCodes: ['F1', 'F2'], channels: ['WEB', 'DESKTOP'] });
  it('lifetime → LICENSE/30 com channels do envelope', () => {
    const p = parseLicenseEnvelope(base('lifetime'));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const up = entitlementUpsertsFor(p.envelope, p.kind, NOW);
    expect(up).toHaveLength(2);
    expect(up?.[0]).toMatchObject({ origin: 'LICENSE', priority: 30, channel: 'WEB', featureCode: 'F1' });
    expect(up?.[1]).toMatchObject({ origin: 'LICENSE', priority: 30, channel: 'DESKTOP', featureCode: 'F2' });
  });
  it('monthly/annual → SUBSCRIPTION/20', () => {
    for (const kind of ['monthly', 'annual']) {
      const p = parseLicenseEnvelope(base(kind));
      expect(p.ok).toBe(true);
      if (!p.ok) continue;
      expect(entitlementUpsertsFor(p.envelope, p.kind, NOW)?.[0]).toMatchObject({
        origin: 'SUBSCRIPTION',
        priority: 20,
      });
    }
  });
  it('legado sem kind → LICENSE/30 channel BOTH', () => {
    const p = parseLicenseEnvelope(issued());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(entitlementUpsertsFor(p.envelope, p.kind, NOW)?.[0]).toMatchObject({
      origin: 'LICENSE',
      priority: 30,
      channel: 'BOTH',
    });
  });
  it('channel estranho cai p/ BOTH (fail-open legado)', () => {
    const p = parseLicenseEnvelope(issued({ featureCodes: ['F1'], channels: ['MOBILE'] }));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(entitlementUpsertsFor(p.envelope, p.kind, NOW)?.[0].channel).toBe('BOTH');
  });
});

describe('entitlementUpsertsFor', () => {
  it('issued → ACTIVE priority 30 com graça +3d calculada', () => {
    const p = parseLicenseEnvelope(issued());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const up = entitlementUpsertsFor(p.envelope, p.kind, NOW);
    expect(up).toHaveLength(1);
    expect(up?.[0]).toMatchObject({
      origin: 'LICENSE', originId: 'lic-1', priority: 30, status: 'ACTIVE',
      ownerId: 'cust-1', productId: 'prod-1', featureCode: 'F1', wildcard: false,
      expiresAt: '2026-11-10T12:00:00.000Z', graceUntil: '2026-11-13T12:00:00.000Z',
    });
  });
  it('renewed mantém continuidade (starts_at = max now)', () => {
    const raw = issued({ prevExpiresAt: '2026-10-08T12:00:00.000Z', expiresAt: '2026-12-08T12:00:00.000Z' });
    const p = parseLicenseEnvelope({ ...raw, topic: 'licensing.license.renewed.v1', eventId: 'evt-renewed-02' });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const up = entitlementUpsertsFor(p.envelope, p.kind, NOW);
    // prev (08/out) < now (10/out) → starts_at = now.
    expect(up?.[0].startsAt).toBe('2026-10-10T12:00:00.000Z');
    expect(up?.[0].status).toBe('ACTIVE');
  });
  it('revoked/suspended mapeiam status terminal-like', () => {
    for (const [topic, want] of [['licensing.license.revoked.v1', 'REVOKED'], ['licensing.license.suspended.v1', 'SUSPENDED']] as const) {
      const raw = issued();
      const p = parseLicenseEnvelope({ ...raw, topic, eventId: `evt-${want}-x` });
      expect(p.ok).toBe(true);
      if (!p.ok) continue;
      expect(entitlementUpsertsFor(p.envelope, p.kind, NOW)?.[0].status).toBe(want);
    }
  });
  it('device/clone não reescrevem vigência (só invalidam cache)', () => {
    for (const topic of ['licensing.device.linked.v1', 'licensing.device.unlinked.v1', 'licensing.device.clone_suspect.v1']) {
      const p = parseLicenseEnvelope({ ...issued(), topic, eventId: `evt-${topic}-x-yz` });
      expect(p.ok).toBe(true);
      if (!p.ok) continue;
      expect(entitlementUpsertsFor(p.envelope, p.kind, NOW)).toBeNull();
    }
  });
});

describe('chaves de idempotência', () => {
  it('grant key determinística por (paymentId, licenseId)', () => {
    expect(grantIdempotencyKey('pay-1', 'lic-1')).toBe('grant:pay-1:lic-1');
    expect(grantIdempotencyKey('pay-1', 'lic-1')).toBe(grantIdempotencyKey('pay-1', 'lic-1'));
    expect(grantIdempotencyKey('pay-2', 'lic-1')).not.toBe(grantIdempotencyKey('pay-1', 'lic-1'));
  });
  it('jobId = eventId; cascade eventId determinístico', () => {
    expect(jobIdForEvent('evt-1-abcd')).toBe('evt-1-abcd');
    expect(cascadeEventId('base', 'ent', 'i1')).toBe('base:ent:i1');
  });
});

const CASCADE: CascadeInput = {
  contractId: 'ctr-1',
  currentContractStatus: 'ACTIVE',
  actor: 'admin-1',
  reason: 'inadimplência confirmada',
  triggerEventId: 'evt-cancel-01',
  occurredAt: '2026-10-10T12:00:00.000Z',
  items: [
    { itemId: 'it-1', productId: 'prod-1', featureCode: 'F1', licenseId: 'lic-1', ownerType: 'CUSTOMER', ownerId: 'cust-1', paymentId: 'pay-1', prevTokenVersion: 2, currentItemStatus: 'ACTIVE', currentEntitlementStatus: 'ACTIVE', currentLicenseStatus: 'ACTIVE' },
    { itemId: 'it-2', productId: 'prod-1', featureCode: 'F2', licenseId: 'lic-2', ownerType: 'CUSTOMER', ownerId: 'cust-1', currentItemStatus: 'CANCELLED', currentEntitlementStatus: 'REVOKED', currentLicenseStatus: 'REVOKED' },
  ],
};

describe('planRevocationCascade (puro)', () => {
  it('cadeia completa: contract→item→entitlement→license+token_version++', () => {
    const plan = planRevocationCascade(CASCADE);
    expect(plan.contract).toMatchObject({ from: 'ACTIVE', to: 'CANCELLED', applied: true });
    expect(plan.items[0]).toMatchObject({ to: 'CANCELLED', applied: true });
    expect(plan.entitlements[0]).toMatchObject({ to: 'REVOKED', applied: true });
    expect(plan.licenses[0]).toMatchObject({ to: 'REVOKED', applied: true, tokenVersion: 3 });
    expect(plan.outbox.map((o) => o.eventId)).toEqual([
      'evt-cancel-01:ent:it-1:F1',
      'evt-cancel-01:lic:lic-1',
    ]);
  });
  it('já-terminal vira no-op sem outbox (idempotente)', () => {
    const plan = planRevocationCascade(CASCADE);
    expect(plan.items[1].applied).toBe(false);
    expect(plan.entitlements[1].applied).toBe(false);
    expect(plan.licenses[1].applied).toBe(false);
    expect(plan.outbox).toHaveLength(2);
  });
  it('replay do mesmo gatilho gera os mesmos eventIds', () => {
    const a = planRevocationCascade(CASCADE);
    const b = planRevocationCascade(CASCADE);
    expect(b).toEqual(a);
  });
  it('contract terminal não retransiciona', () => {
    const plan = planRevocationCascade({ ...CASCADE, currentContractStatus: 'CANCELLED', items: [] });
    expect(plan.contract.applied).toBe(false);
    expect(plan.outbox).toHaveLength(0);
  });
});

// --- Fake infra p/ testes de serviço (sem PG/Redis) ---

function makeFakeDb(overrides: { infoSchemaRows?: Array<Record<string, unknown>> } = {}): SqlRunner & {
  calls: Array<{ sql: string; params?: unknown[] }>;
  state: { outbox: Set<string>; upserts: number; updates: number };
} {
  const fake = {
    calls: [] as Array<{ sql: string; params?: unknown[] }>,
    state: { outbox: new Set<string>(), upserts: 0, updates: 0 },
    async query(sql: string, params?: unknown[]): Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }> {
      fake.calls.push({ sql, params });
      if (sql.includes('information_schema')) {
        return { rowCount: overrides.infoSchemaRows?.length ?? 0, rows: overrides.infoSchemaRows ?? [] };
      }
      if (sql.includes('outbox_events')) {
        const id = String(params?.[0]);
        if (fake.state.outbox.has(id)) return { rowCount: 0, rows: [] };
        fake.state.outbox.add(id);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('INSERT INTO entitlements')) {
        fake.state.upserts += 1;
        return { rowCount: 1, rows: [{ id: 'ent-1', status: params?.[8] }] };
      }
      if (sql.includes('UPDATE entitlements') || sql.includes('UPDATE contracts') || sql.includes('UPDATE contract_items') || sql.includes('UPDATE licenses') || sql.includes('INSERT INTO access_adjustments')) {
        fake.state.updates += 1;
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  return fake;
}

function makeFakeCache(): { invalidated: string[][]; invalidate(keys: string[]): Promise<number> } {
  return {
    invalidated: [],
    async invalidate(keys: string[]): Promise<number> {
      this.invalidated.push(keys);
      return keys.length;
    },
  };
}

describe('LicensingSyncService.handleEnvelope (idempotência)', () => {
  it('replay do mesmo eventId não duplica upsert/outbox/cache', async () => {
    const db = makeFakeDb();
    const cache = makeFakeCache();
    const svc = new LicensingSyncService(db).withCache(cache);
    const raw = issued();

    const first = await svc.handleEnvelope(raw, NOW);
    expect(first.duplicate).toBe(false);
    if (first.duplicate === false) {
      expect(first.entitlements).toEqual(['ent-1']);
      expect(first.invalidated).toContain('access:check:v1:CUSTOMER:cust-1:prod-1:F1:WEB');
      expect(first.invalidated).toContain('access:check:v1:CUSTOMER:cust-1:prod-1:F1:DESKTOP');
      expect(first.invalidated).toContain('access:check:v1:CUSTOMER:cust-1:prod-1:F1:ANY');
      expect(first.invalidated).toContain('access:cust-1:prod-1:F1');
      expect(first.outbox).toBe(true);
    }
    expect(db.state.upserts).toBe(1);

    const second = await svc.handleEnvelope(raw, NOW);
    expect(second).toMatchObject({ duplicate: true, eventId: 'evt-issued-0001' });
    expect(db.state.upserts).toBe(1); // sem reescrita
    expect(cache.invalidated).toHaveLength(1); // sem reinvalidação
  });

  it('upsert nunca regride REVOKED (fora de ordem)', async () => {
    const db = makeFakeDb();
    const svc = new LicensingSyncService(db).withCache(makeFakeCache());
    const raw = { ...issued(), topic: 'licensing.license.renewed.v1', eventId: 'evt-renewed-99' };
    await svc.handleEnvelope(raw, NOW);
    const upsert = db.calls.find((c) => c.sql.includes('INSERT INTO entitlements'));
    expect(upsert?.sql).toContain(`WHEN entitlements.status = 'REVOKED' THEN 'REVOKED'`);
  });

  it('suspend aplica só sobre ACTIVE/GRACE/SUSPENDED (não congela EXPIRED)', async () => {
    const db = makeFakeDb();
    const svc = new LicensingSyncService(db).withCache(makeFakeCache());
    await svc.handleEnvelope({ ...issued(), topic: 'licensing.license.suspended.v1', eventId: 'evt-susp-0077' }, NOW);
    const upd = db.calls.find((c) => c.sql.includes('UPDATE entitlements'));
    expect(upd?.sql).toContain(`status IN ('ACTIVE', 'GRACE', 'SUSPENDED')`);
  });

  it('device-linked sem owner/product vira no-op consumido (sem efeito)', async () => {
    const db = makeFakeDb();
    const svc = new LicensingSyncService(db).withCache(makeFakeCache());
    const r = await svc.handleEnvelope({
      eventId: 'evt-devlink-1', topic: 'licensing.device.linked.v1', version: 1,
      occurredAt: NOW.toISOString(), payload: { licenseId: 'lic-1' },
    }, NOW);
    expect(r.duplicate).toBe(false);
    if (r.duplicate === false) {
      expect(r.entitlements).toEqual([]);
      expect(r.invalidated).toEqual([]);
    }
  });
});

describe('LicensingSyncService.executeCascade', () => {
  it('sem licensingDb: licença pendente com token_version calculado', async () => {
    const db = makeFakeDb();
    const svc = new LicensingSyncService(db).withCache(makeFakeCache());
    const r = await svc.executeCascade(CASCADE);
    expect(r.contract).toBe('CANCELLED');
    expect(r.itemsCancelled).toBe(1);
    expect(r.entitlementsRevoked).toBe(1);
    expect(r.license).toMatchObject({ applied: 0, persisted: false });
    expect((r.license as { tokenVersions: Record<string, number> }).tokenVersions).toEqual({ 'lic-1': 3 });
    expect(r.pendingLicensingOutbox).toBe(1);
  });
  it('com licensingDb sem coluna token_version: revoga status, não persiste versão', async () => {
    const db = makeFakeDb();
    const lic = makeFakeDb(); // information_schema vazio → sem coluna
    const svc = new LicensingSyncService(db).withCache(makeFakeCache()).withLicensingDb(lic);
    const r = await svc.executeCascade(CASCADE);
    expect(lic.calls.some((c) => c.sql.includes('UPDATE licenses SET status'))).toBe(true);
    expect(lic.calls.some((c) => c.sql.includes('token_version = token_version + 1'))).toBe(false);
    expect(r.license).toMatchObject({ applied: 1, persisted: false });
    expect(r.pendingLicensingOutbox).toBe(0);
  });
  it('com coluna token_version: bump ++', async () => {
    const db = makeFakeDb();
    const lic = makeFakeDb({ infoSchemaRows: [{ '?column?': 1 }] });
    const svc = new LicensingSyncService(db).withCache(makeFakeCache()).withLicensingDb(lic);
    const r = await svc.executeCascade(CASCADE);
    expect(lic.calls.some((c) => c.sql.includes('token_version = token_version + 1'))).toBe(true);
    expect(r.license).toMatchObject({ applied: 1, persisted: true });
  });
  it('contract já CANCELLED não reexecuta UPDATE', async () => {
    const db = makeFakeDb();
    const svc = new LicensingSyncService(db).withCache(makeFakeCache());
    await svc.executeCascade({ ...CASCADE, currentContractStatus: 'CANCELLED', items: [] });
    expect(db.calls.some((c) => c.sql.includes('UPDATE contracts'))).toBe(false);
  });
});
