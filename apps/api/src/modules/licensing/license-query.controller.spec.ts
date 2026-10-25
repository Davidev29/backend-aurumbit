import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { JwtService } from '../../common/auth/jwt.service';
import { InMemorySessionLookup, SESSION_LOOKUP } from '../../common/auth/session-lookup.port';
import { GuardsModule } from '../../common/guards/guards.module';
import { AuditService } from '../audit/audit.service';
import { InMemoryLicenseStore, LICENSE_STORE } from './license-store';
import { LicenseQueryController } from './license-query.controller';
import { LicensingFlowService } from './licensing-flow.service';

// Rotas novas do BFF sobre o fluxo in-memory: guard RBAC real (JWT + RolesGuard),
// sem dump sem filtro.
describe('LicenseQueryController (by-product/history)', () => {
  let app: INestApplication;
  let flow: LicensingFlowService;
  let jwt: JwtService;
  let sessions: InMemorySessionLookup;
  const HOUR = 3_600_000;

  const mintAdmin = (): string =>
    jwt.sign({
      sub: 'user-1',
      sid: 'sid-ok',
      amr: ['pwd', 'mfa'],
      email_verified: true,
      roles: ['STAFF_ADMIN'],
    } as never);

  const mintNoRole = (): string =>
    jwt.sign({
      sub: 'user-1',
      sid: 'sid-ok',
      amr: ['pwd'],
      email_verified: true,
      roles: [],
    } as never);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [GuardsModule],
      controllers: [LicenseQueryController],
      providers: [
        { provide: LICENSE_STORE, useClass: InMemoryLicenseStore },
        LicensingFlowService,
        AuditService,
      ],
    })
      .overrideProvider(SESSION_LOOKUP)
      .useClass(InMemorySessionLookup)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    flow = moduleFixture.get(LicensingFlowService);
    jwt = moduleFixture.get(JwtService);
    sessions = moduleFixture.get(SESSION_LOOKUP) as InMemorySessionLookup;
    sessions.seed({ id: 'sid-ok', identityId: 'user-1', status: 'ACTIVE', expiresAt: new Date(Date.now() + HOUR) });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('sem token → 401 nas duas rotas', async () => {
    await request(app.getHttpServer()).get('/v1/licenses/by-product/P1').expect(401);
    await request(app.getHttpServer()).get('/v1/licenses/whatever/history').expect(401);
  });

  it('token sem role STAFF_ADMIN → 403 nas duas rotas', async () => {
    const token = mintNoRole();
    await request(app.getHttpServer()).get('/v1/licenses/by-product/P1').set('Authorization', `Bearer ${token}`).expect(403);
    await request(app.getHttpServer()).get('/v1/licenses/whatever/history').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('by-product lista mascarado do produto; history reflete issue→revoke', async () => {
    const token = mintAdmin();
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
      .set('Authorization', `Bearer ${token}`)
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
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(empty.body).toEqual([]);

    await flow.revoke(issued.id, { actor: 'tester', reason: 'trocada por outra agora', replacedBy: 'lic-2' });
    const history = await request(app.getHttpServer())
      .get(`/v1/licenses/${issued.id}/history`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(history.body.map((h: { status: string }) => h.status)).toEqual(
      expect.arrayContaining(['active', 'revoked']),
    );
    expect(history.body.find((h: { status: string }) => h.status === 'revoked')).toMatchObject({
      replacedBy: 'lic-2',
    });
  });

  it('history de licença inexistente → 404', async () => {
    const token = mintAdmin();
    await request(app.getHttpServer())
      .get('/v1/licenses/missing/history')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
