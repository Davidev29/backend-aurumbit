import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AdminStubGuard } from '../src/modules/access/admin.guard';
import { AuditService } from '../src/modules/audit/audit.service';
import { LICENSE_STORE, InMemoryLicenseStore } from '../src/modules/licensing/license-store';
import { LicensesController } from '../src/modules/licensing/licenses.controller';
import { LicensingFlowService } from '../src/modules/licensing/licensing-flow.service';

// Fluxo de licenciamento (e2e hermético, sem PG/Redis):
// issue → link → allow → renew em grace → revoke deny + token_version.
// Guarda stub `x-role: admin` (mesmo padrão de `access/admin`).
describe('Licensing flow (e2e)', () => {
  let app: INestApplication;
  let audit: AuditService;
  const admin = { 'x-role': 'admin' };
  const PAID_AT = '2026-01-01T00:00:00.000Z';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LicensesController],
      providers: [
        { provide: LICENSE_STORE, useClass: InMemoryLicenseStore },
        LicensingFlowService,
        AuditService,
        AdminStubGuard,
      ],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    audit = moduleFixture.get(AuditService);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('issue emite chave 1x + máscara; GET posterior nunca vaza plaintext', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/licenses')
      .set(admin)
      .send({ ownerId: 'owner-1', productId: 'prod-1', months: 1, paidAt: PAID_AT, actor: 'tester' })
      .expect(201);
    expect(res.body.key).toMatch(/^AURUM-/);
    expect(res.body.keyMasked).toMatch(/^AURUM-••••-••••-/);
    expect(res.body.tokenVersion).toBe(1);
    expect(res.body.status).toBe('active');

    const got = await request(app.getHttpServer())
      .get(`/v1/licenses/${res.body.id}`)
      .set(admin)
      .expect(200);
    expect(got.body.key).toBeUndefined();
    expect(got.body.key_hash).toBeUndefined();
    expect(got.body.key_enc).toBeUndefined();
    expect(got.body.keyMasked).toBe(res.body.keyMasked);
  });

  it('link → check allow ACTIVE', async () => {
    const issued = await request(app.getHttpServer())
      .post('/v1/licenses')
      .set(admin)
      .send({ ownerId: 'owner-2', productId: 'prod-1', months: 1, paidAt: PAID_AT, actor: 'tester' })
      .expect(201);
    const id = issued.body.id as string;

    const link = await request(app.getHttpServer())
      .post(`/v1/licenses/${id}/devices/link`)
      .set(admin)
      .send({ app_instance_id: 'app-1' })
      .expect(200);
    expect(link.body.deviceHash).toMatch(/^[0-9a-f]{64}$/);

    const check = await request(app.getHttpServer())
      .get(`/v1/licenses/${id}/check`)
      .set(admin)
      .query({ deviceHash: link.body.deviceHash, now: '2026-01-15T00:00:00.000Z' })
      .expect(200);
    expect(check.body).toMatchObject({ allow: true, degraded: false, reason: 'ACTIVE' });
  });

  it('renew em grace mantém continuidade (starts_at = expires anterior)', async () => {
    const issued = await request(app.getHttpServer())
      .post('/v1/licenses')
      .set(admin)
      .send({ ownerId: 'owner-3', productId: 'prod-1', months: 1, paidAt: PAID_AT, actor: 'tester' })
      .expect(201);
    const id = issued.body.id as string;
    const prevExpires = issued.body.expiresAt as string; // 2026-02-01

    // Dentro da graça (expires 2026-02-01, grace até 2026-02-04):
    // starts_at = max(now, expires anterior) = now (sem sobreposição).
    const renewed = await request(app.getHttpServer())
      .post(`/v1/licenses/${id}/renew`)
      .set(admin)
      .send({ now: '2026-02-02T00:00:00.000Z', actor: 'tester' })
      .expect(201);
    expect(renewed.body.startsAt).toBe('2026-02-02T00:00:00.000Z');
    expect(Date.parse(renewed.body.startsAt)).toBeGreaterThanOrEqual(Date.parse(prevExpires));
    expect(renewed.body.status).toBe('active');

    const check = await request(app.getHttpServer())
      .get(`/v1/licenses/${id}/check`)
      .set(admin)
      .query({ now: '2026-02-10T00:00:00.000Z' })
      .expect(200);
    expect(check.body.allow).toBe(true);
  });

  it('revoke bump token_version e nega check (REVOKED)', async () => {
    const issued = await request(app.getHttpServer())
      .post('/v1/licenses')
      .set(admin)
      .send({ ownerId: 'owner-4', productId: 'prod-1', months: 1, paidAt: PAID_AT, actor: 'tester' })
      .expect(201);
    const id = issued.body.id as string;
    expect(issued.body.tokenVersion).toBe(1);

    const link = await request(app.getHttpServer())
      .post(`/v1/licenses/${id}/devices/link`)
      .set(admin)
      .send({ app_instance_id: 'app-9' })
      .expect(200);

    // Offline-token pré-revogação (tv=1) p/ provar invalidação pós-revoke.
    const pre = await request(app.getHttpServer())
      .post(`/v1/licenses/${id}/offline-token`)
      .set(admin)
      .send({ device_hash: link.body.deviceHash, iat: '2026-01-15T00:00:00.000Z' })
      .expect(201);
    expect(pre.body.token).toBeDefined();

    const revoked = await request(app.getHttpServer())
      .post(`/v1/licenses/${id}/revoke`)
      .set(admin)
      .send({ actor: 'tester', reason: 'fraude confirmada' })
      .expect(201);
    expect(revoked.body.tokenVersion).toBe(2);

    const check = await request(app.getHttpServer())
      .get(`/v1/licenses/${id}/check`)
      .set(admin)
      .query({ deviceHash: link.body.deviceHash, now: '2026-01-16T00:00:00.000Z' })
      .expect(200);
    expect(check.body).toMatchObject({ allow: false, reason: 'REVOKED', errorCode: 'REVOKED' });

    const stale = await request(app.getHttpServer())
      .post('/v1/licenses/offline/check')
      .set(admin)
      .send({ token: pre.body.token, now: '2026-01-16T00:00:00.000Z' })
      .expect(200);
    expect(stale.body.allow).toBe(false);
    // Precedência: status revogado nega como REVOKED (token_version só é
    // avaliado com status vigente — ex. após rotate, que dá MISMATCH).
    expect(stale.body.reason).toBe('REVOKED');

    // Pós-revoke: mint recusa (token_version invalidado no próximo online).
    await request(app.getHttpServer())
      .post(`/v1/licenses/${id}/offline-token`)
      .set(admin)
      .send({ device_hash: link.body.deviceHash, iat: '2026-01-16T00:00:00.000Z' })
      .expect(409);
  });

  it('reveal retorna plaintext 1x e audita sem vazar a chave', async () => {
    const issued = await request(app.getHttpServer())
      .post('/v1/licenses')
      .set(admin)
      .send({ ownerId: 'owner-5', productId: 'prod-1', months: 1, paidAt: PAID_AT, actor: 'tester' })
      .expect(201);
    const revealed = await request(app.getHttpServer())
      .post(`/v1/licenses/${issued.body.id}/reveal`)
      .set(admin)
      .send({ actor: 'tester', reason: 'suporte ao titular' })
      .expect(201);
    expect(revealed.body.key).toBe(issued.body.key);
    const evs = audit.list('license.reveal').filter((e) => e.entityId === issued.body.id);
    expect(evs.length).toBeGreaterThan(0);
    expect(JSON.stringify(evs[evs.length - 1].metadata)).not.toContain(issued.body.key);
  });

  it('audit: eventos sem PII (só keyMasked/device_hash)', async () => {
    const events = audit.list();
    const actions = events.map((e) => e.action);
    for (const want of ['license.issue', 'device.link', 'license.renew', 'license.revoke']) {
      expect(actions).toContain(want);
    }
    for (const e of events) {
      const meta = JSON.stringify(e.metadata);
      expect(meta).not.toMatch(/^AURUM-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/m);
      expect(meta).not.toContain('app-1');
      expect(meta).not.toContain('app-9');
      for (const k of Object.keys(e.metadata)) {
        expect(['keyMasked', 'device_hash', 'tokenVersion', 'reason', 'months', 'template', 'eventId']).toContain(k);
      }
    }
  });
});
