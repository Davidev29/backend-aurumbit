import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Env de teste via ./setup-e2e.ts (setupFiles, antes dos imports).
// Sem PG/Redis reais, /health/ready responde 503 (comportamento esperado e assertado abaixo).
describe('Health (e2e)', () => {
  let app: INestApplication | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready'] });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('/health/live (GET) → 200 {status:"ok"}', async () => {
    await request(app!.getHttpServer()).get('/health/live').expect(200).expect((res) => {
      if (res.body?.status !== 'ok') throw new Error(`live inesperado: ${JSON.stringify(res.body)}`);
    });
  });

  it('/health/ready (GET) → 200|503 com envelope postgres/redis', async () => {
    await request(app!.getHttpServer())
      .get('/health/ready')
      .expect((res) => {
        if (![200, 503].includes(res.status)) {
          throw new Error(`ready: status inesperado ${res.status}: ${JSON.stringify(res.body)}`);
        }
        if (!('postgres' in (res.body ?? {})) || !('redis' in (res.body ?? {}))) {
          throw new Error(`ready: envelope sem postgres/redis: ${JSON.stringify(res.body)}`);
        }
      });
  });
});
