import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { JwtService } from '../src/common/auth/jwt.service';
import { InMemoryMembershipLookup, MEMBERSHIP_LOOKUP } from '../src/common/auth/membership-lookup.port';
import { InMemorySessionLookup, SESSION_LOOKUP } from '../src/common/auth/session-lookup.port';
import { GuardsModule } from '../src/common/guards/guards.module';
import { GuardedTestController } from './helpers/guarded-test.controller';

// Cadeia APP_GUARD real (GuardsModule) sobre controller de teste hermético
// (sem PG/Redis). Tokens mintados pelo próprio JwtService da cadeia.
describe('Auth guards (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let sessions: InMemorySessionLookup;
  let memberships: InMemoryMembershipLookup;

  const HOUR = 3_600_000;

  const mint = (over: Record<string, unknown> = {}): string =>
    jwt.sign({
      sub: 'user-1',
      sid: 'sid-ok',
      amr: ['pwd'],
      email_verified: true,
      roles: ['STAFF_ADMIN'],
      ...over,
    } as never);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [GuardsModule],
      controllers: [GuardedTestController],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    jwt = moduleFixture.get(JwtService);
    sessions = moduleFixture.get(SESSION_LOOKUP) as InMemorySessionLookup;
    memberships = moduleFixture.get(MEMBERSHIP_LOOKUP) as InMemoryMembershipLookup;

    sessions.seed({ id: 'sid-ok', identityId: 'user-1', status: 'ACTIVE', expiresAt: new Date(Date.now() + HOUR) });
    sessions.seed({ id: 'sid-revoked', identityId: 'user-1', status: 'REVOKED', expiresAt: new Date(Date.now() + HOUR) });
    sessions.seed({ id: 'sid-expired', identityId: 'user-1', status: 'ACTIVE', expiresAt: new Date(Date.now() - HOUR) });
    memberships.seed({ organizationId: 'org-1', identityId: 'user-1', role: 'ADMIN', status: 'ACTIVE' });
    memberships.seed({ organizationId: 'org-susp', identityId: 'user-1', role: 'MEMBER', status: 'SUSPENDED' });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /t/open (pública) → 200 sem token', async () => {
    await request(app.getHttpServer()).get('/t/open').expect(200);
  });

  it('401 sem token', async () => {
    await request(app.getHttpServer()).get('/t/protected').expect(401);
  });

  it('401 com token inválido', async () => {
    await request(app.getHttpServer()).get('/t/protected').set('Authorization', 'Bearer quebrado').expect(401);
  });

  it('401 com token expirado', async () => {
    const token = jwt.sign({ sub: 'user-1', sid: 'sid-ok', issuedAtSec: Math.floor(Date.now() / 1000) - 3600, expiresInSec: 60 });
    await request(app.getHttpServer()).get('/t/protected').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('401 com sessão desconhecida', async () => {
    await request(app.getHttpServer())
      .get('/t/protected')
      .set('Authorization', `Bearer ${mint({ sid: 'sid-fantasma' })}`)
      .expect(401);
  });

  it('401 com sessão revogada/expirada', async () => {
    await request(app.getHttpServer())
      .get('/t/protected')
      .set('Authorization', `Bearer ${mint({ sid: 'sid-revoked' })}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/t/protected')
      .set('Authorization', `Bearer ${mint({ sid: 'sid-expired' })}`)
      .expect(401);
  });

  it('200 caminho feliz (jwt+session+verified)', async () => {
    await request(app.getHttpServer())
      .get('/t/protected')
      .set('Authorization', `Bearer ${mint()}`)
      .expect(200)
      .expect((res) => {
        if (res.body?.sub !== 'user-1') throw new Error(`principal inesperado: ${JSON.stringify(res.body)}`);
      });
  });

  it('403 sem MFA stub em rota @RequireMfa; 200 com amr mfa', async () => {
    await request(app.getHttpServer()).get('/t/mfa').set('Authorization', `Bearer ${mint()}`).expect(403);
    await request(app.getHttpServer())
      .get('/t/mfa')
      .set('Authorization', `Bearer ${mint({ amr: ['pwd', 'mfa'] })}`)
      .expect(200);
  });

  it('403 e-mail não verificado; 200 em rota @AllowUnverified', async () => {
    const token = mint({ email_verified: false });
    await request(app.getHttpServer()).get('/t/protected').set('Authorization', `Bearer ${token}`).expect(403);
    await request(app.getHttpServer()).get('/t/unverified-ok').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('403 sem role STAFF_*; 200 com STAFF_ADMIN', async () => {
    await request(app.getHttpServer())
      .get('/t/staff')
      .set('Authorization', `Bearer ${mint({ roles: [] })}`)
      .expect(403);
    await request(app.getHttpServer()).get('/t/staff').set('Authorization', `Bearer ${mint()}`).expect(200);
  });

  it('@CustomerScope: 400 sem X-Org-Id, 403 sem vínculo, 200 com membership ACTIVE', async () => {
    await request(app.getHttpServer()).get('/t/org').set('Authorization', `Bearer ${mint()}`).expect(400);
    await request(app.getHttpServer())
      .get('/t/org')
      .set('Authorization', `Bearer ${mint()}`)
      .set('X-Org-Id', 'org-fantasma')
      .expect(403);
    await request(app.getHttpServer())
      .get('/t/org')
      .set('Authorization', `Bearer ${mint()}`)
      .set('X-Org-Id', 'org-susp')
      .expect(403);
    await request(app.getHttpServer())
      .get('/t/org')
      .set('Authorization', `Bearer ${mint()}`)
      .set('X-Org-Id', 'org-1')
      .expect(200)
      .expect((res) => {
        if (res.body?.org?.id !== 'org-1' || res.body?.org?.role !== 'ADMIN') {
          throw new Error(`escopo inesperado: ${JSON.stringify(res.body)}`);
        }
      });
  });
});
