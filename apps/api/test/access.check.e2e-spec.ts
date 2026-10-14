import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { CheckAccessResponseSchema } from '../../../libs/contracts/src/access';
import { ERROR_CODES } from '../../../libs/contracts/src/index';
import { JwtService } from '../src/common/auth/jwt.service';
import { InMemorySessionLookup, SESSION_LOOKUP } from '../src/common/auth/session-lookup.port';
import { GuardsModule } from '../src/common/guards/guards.module';
import { GuardedTestController } from './helpers/guarded-test.controller';

// check-access (e2e): allow/deny/degraded via HTTP, resposta validada
// contra o contrato zod. Semântica PROJECT §1 sobre `evaluateCheck` puro.
describe('Access check (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [GuardsModule],
      controllers: [GuardedTestController],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const jwt = moduleFixture.get(JwtService);
    const sessions = moduleFixture.get(SESSION_LOOKUP) as InMemorySessionLookup;
    sessions.seed({ id: 'sid-ok', identityId: 'user-1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3_600_000) });
    token = jwt.sign({ sub: 'user-1', sid: 'sid-ok', email_verified: true });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('ERROR_CODES contém EXPIRED e DEVICE_LIMIT', () => {
    expect(ERROR_CODES).toContain('EXPIRED');
    expect(ERROR_CODES).toContain('DEVICE_LIMIT');
  });

  it('401 sem token no check', async () => {
    await request(app.getHttpServer()).get('/t/check?scenario=active').expect(401);
  });

  it('allow (vigente) → { allow:true, degraded:false }', async () => {
    await request(app.getHttpServer())
      .get('/t/check?scenario=active')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        const body = CheckAccessResponseSchema.parse(res.body);
        if (!body.allow || body.degraded || body.reason !== 'ACTIVE') {
          throw new Error(`allow inesperado: ${JSON.stringify(body)}`);
        }
      });
  });

  it('degraded (graça) → { allow:true, degraded:true }', async () => {
    await request(app.getHttpServer())
      .get('/t/check?scenario=grace')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        const body = CheckAccessResponseSchema.parse(res.body);
        if (!body.allow || !body.degraded || body.reason !== 'GRACE') {
          throw new Error(`degraded inesperado: ${JSON.stringify(body)}`);
        }
      });
  });

  it('deny (expirado) → { allow:false, errorCode:EXPIRED }', async () => {
    await request(app.getHttpServer())
      .get('/t/check?scenario=expired')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        const body = CheckAccessResponseSchema.parse(res.body);
        if (body.allow || body.degraded || body.errorCode !== 'EXPIRED') {
          throw new Error(`deny inesperado: ${JSON.stringify(body)}`);
        }
      });
  });

  it('deny (suspenso/ausente) → allow:false', async () => {
    for (const scenario of ['suspended', 'notfound']) {
      await request(app.getHttpServer())
        .get(`/t/check?scenario=${scenario}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          const body = CheckAccessResponseSchema.parse(res.body);
          if (body.allow) throw new Error(`deny esperado (${scenario}): ${JSON.stringify(body)}`);
        });
    }
  });

  it('contrato aceita deny DEVICE_LIMIT (limite de máquinas)', () => {
    const body = CheckAccessResponseSchema.parse({
      allow: false,
      degraded: false,
      reason: 'DEVICE_LIMIT',
      errorCode: 'DEVICE_LIMIT',
    });
    expect(body.allow).toBe(false);
  });
});
