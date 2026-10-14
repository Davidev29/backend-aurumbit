import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuditService } from '../audit/audit.service';
import { AdminStubGuard } from './admin.guard';
import { InMemoryLicenseStore, LICENSE_STORE } from './license-store';
import { LicenseQueryController } from './license-query.controller';
import { LicensingFlowService } from './licensing-flow.service';

// Rotas novas do BFF sobre o fluxo in-memory: guard admin, sem dump sem filtro.
describe('LicenseQueryController (by-product/history)', () => {
  let app: INestApplication;
  let flow: LicensingFlowService;
  const admin = { 'x-role': 'admin' };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LicenseQueryController],
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
    flow = moduleFixture.get(LicensingFlowService);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('sem x-role:admin → 403 nas duas rotas', async () => {
    await request(app.getHttpServer()).get('/v1/licenses/by-product/P1').expect(403);
    await request(app.getHttpServer()).get('/v1/licenses/whatever/history').expect(403);
  });

  it('by-product lista mascarado do produto; history reflete issue→revoke', async () => {
    const issued = await flow.issue({
      ownerId: 'cus-9',
      ownerLabel: 'Cliente Nove',
      productId: 'AURUM_PRO',
      months: 1,
      paidAt: '2026-01-01T00:00:00.000Z',
      actor: 'tester',
    });

    const list = await request(app.getHttpServer())
      .get('/v1/licenses/by-product/AURUM_PRO')
      .set(admin)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      ownerId: 'cus-9',
      ownerLabel: 'Cliente Nove',
      productId: 'AURUM_PRO',
    });
    expect(list.body[0].key).toBeUndefined();

    const empty = await request(app.getHttpServer())
      .get('/v1/licenses/by-product/OUTRO')
      .set(admin)
      .expect(200);
    expect(empty.body).toEqual([]);

    await flow.revoke(issued.id, { actor: 'tester', reason: 'trocada por outra agora', replacedBy: 'lic-2' });
    const history = await request(app.getHttpServer())
      .get(`/v1/licenses/${issued.id}/history`)
      .set(admin)
      .expect(200);
    expect(history.body.map((h: { status: string }) => h.status)).toEqual(
      expect.arrayContaining(['active', 'revoked']),
    );
    expect(history.body.find((h: { status: string }) => h.status === 'revoked')).toMatchObject({
      replacedBy: 'lic-2',
    });
  });

  it('history de licença inexistente → 404', async () => {
    await request(app.getHttpServer())
      .get('/v1/licenses/missing/history')
      .set(admin)
      .expect(404);
  });
});
