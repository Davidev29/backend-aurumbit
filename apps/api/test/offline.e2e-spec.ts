import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { computeOffExp } from '../src/modules/licensing/offline-jwt';
import { computeOffExpMs, OFFLINE_WINDOW_MS } from '../src/modules/licensing/offline-token.util';
import { AdminStubGuard } from '../src/modules/access/admin.guard';
import { AuditService } from '../src/modules/audit/audit.service';
import { LICENSE_STORE, InMemoryLicenseStore } from '../src/modules/licensing/license-store';
import { LicensesController } from '../src/modules/licensing/licenses.controller';
import { LicensingFlowService } from '../src/modules/licensing/licensing-flow.service';

// Offline 7d (e2e hermético, sem PG/Redis — PROJECT.md §1, ADR-003):
// off_exp = min(iat+7d, expires+7d), grace vence offline, sem GPS.
describe('Offline token (e2e)', () => {
  let app: INestApplication;
  const admin = { 'x-role': 'admin' };
  const PAID_AT = '2026-01-01T00:00:00.000Z'; // expires 2026-02-01, grace até 2026-02-04

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
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function issueAndLink(owner: string, appInstance: string) {
    const issued = await request(app.getHttpServer())
      .post('/v1/licenses')
      .set(admin)
      .send({ ownerId: owner, productId: 'prod-1', months: 1, paidAt: PAID_AT, actor: 'tester' })
      .expect(201);
    const link = await request(app.getHttpServer())
      .post(`/v1/licenses/${issued.body.id}/devices/link`)
      .set(admin)
      .send({ app_instance_id: appInstance })
      .expect(200);
    return { id: issued.body.id as string, deviceHash: link.body.deviceHash as string };
  }

  it('off_exp = min(iat+7d, expires+7d)', async () => {
    const { id, deviceHash } = await issueAndLink('off-1', 'off-app-1');
    const iat = '2026-01-15T00:00:00.000Z';
    const minted = await request(app.getHttpServer())
      .post(`/v1/licenses/${id}/offline-token`)
      .set(admin)
      .send({ device_hash: deviceHash, iat })
      .expect(201);
    const iatMs = Date.parse(iat);
    const expMs = Date.parse('2026-02-01T00:00:00.000Z');
    expect(Date.parse(minted.body.offExp)).toBe(Math.min(iatMs + OFFLINE_WINDOW_MS, expMs + OFFLINE_WINDOW_MS));
    // Lib JWT canônica concorda (s): mesma fórmula em epoch s.
    const iatS = Math.floor(iatMs / 1000);
    const expS = Math.floor(expMs / 1000);
    expect(computeOffExp(iatS, expS)).toBe(Math.floor(Date.parse(minted.body.offExp) / 1000));
    expect(computeOffExpMs(iatMs, expMs)).toBe(Date.parse(minted.body.offExp));
  });

  it('grace vence offline: now > grace_until nega EXPIRED mesmo com off_exp válido', async () => {
    const { id, deviceHash } = await issueAndLink('off-2', 'off-app-2');
    const minted = await request(app.getHttpServer())
      .post(`/v1/licenses/${id}/offline-token`)
      .set(admin)
      .send({ device_hash: deviceHash, iat: '2026-02-01T00:00:00.000Z' })
      .expect(201);
    // off_exp = min(02-01+7d, 02-01+7d) = 02-08; grace_until = 02-04.
    // Em 02-06: dentro do off_exp, além da graça → EXPIRED.
    const denied = await request(app.getHttpServer())
      .post('/v1/licenses/offline/check')
      .set(admin)
      .send({ token: minted.body.token, now: '2026-02-06T00:00:00.000Z' })
      .expect(200);
    expect(denied.body).toMatchObject({ allow: false, reason: 'EXPIRED' });
  });

  it('now > off_exp nega OFFLINE_EXPIRED (exige online)', async () => {
    const { id, deviceHash } = await issueAndLink('off-3', 'off-app-3');
    const minted = await request(app.getHttpServer())
      .post(`/v1/licenses/${id}/offline-token`)
      .set(admin)
      .send({ device_hash: deviceHash, iat: '2026-01-01T00:00:00.000Z' })
      .expect(201);
    // off_exp = 01-08; em 01-10 (ainda vigente, expires 02-01) → OFFLINE_EXPIRED.
    const denied = await request(app.getHttpServer())
      .post('/v1/licenses/offline/check')
      .set(admin)
      .send({ token: minted.body.token, now: '2026-01-10T00:00:00.000Z' })
      .expect(200);
    expect(denied.body).toMatchObject({ allow: false, reason: 'OFFLINE_EXPIRED' });
  });

  it('sem GPS: token não carrega geolocalização', async () => {
    const { id, deviceHash } = await issueAndLink('off-4', 'off-app-4');
    const minted = await request(app.getHttpServer())
      .post(`/v1/licenses/${id}/offline-token`)
      .set(admin)
      .send({ device_hash: deviceHash, iat: '2026-01-15T00:00:00.000Z' })
      .expect(201);
    const raw = `${minted.body.token}`;
    const payloadSeg = raw.split('.')[0];
    const payload = JSON.parse(Buffer.from(payloadSeg, 'base64url').toString('utf8'));
    for (const banned of ['lat', 'lon', 'latitude', 'longitude', 'gps', 'geo', 'country']) {
      expect(JSON.stringify(payload).toLowerCase()).not.toContain(banned);
    }
  });
});
