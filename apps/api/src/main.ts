import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { parseAllowlist, securityHelmetOptions } from './common/http/security';
// Re-export p/ compatibilidade (Fase ≤5 importava `parseAllowlist` daqui).
export { parseAllowlist, securityHelmetOptions } from './common/http/security';

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-correlation-id'];
  const correlationId = Array.isArray(incoming) ? incoming[0] : incoming ?? randomUUID();
  res.setHeader('x-correlation-id', correlationId);
  next();
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));

  app.use(helmet(securityHelmetOptions()));
  app.use(correlationIdMiddleware);

  const allowlist = parseAllowlist(process.env.CORS_ORIGINS);
  if (allowlist.length === 0) {
    console.warn('[security] CORS sem origens permitidas (fail-closed; configure CORS_ORIGINS p/ SPAs)');
  }
  app.enableCors({ origin: allowlist, credentials: true });

  // Prefixo /v1 para negócio; probes/métricas/admin-raiz ficam na raiz
  // (aceite Fase 1: curl -f http://localhost:3000/health/ready;
  // Fase 6: /metrics p/ scrape + /admin/queues p/ Bull Board stub).
  // Webhooks de provedores também ficam na raiz (URLs públicas estáveis,
  // registradas nos dashboards — ex. Resend `POST /webhooks/resend`).
  app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready', 'metrics', 'admin/queues', 'webhooks/resend'] });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // SIGTERM/SIGINT: sem isto o Nest NÃO intercepta o sinal e nenhum
  // `OnApplicationShutdown` roda — o `AuthPoolShutdown` de auth.module.ts
  // nunca chamaria `pool.end()` e o pod sairia no grace period do orchestrator
  // com os pools abertos (conexões penduradas no shutdown).
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  app.get(Logger).log(`API listening on :${port}`);
}

void bootstrap();
