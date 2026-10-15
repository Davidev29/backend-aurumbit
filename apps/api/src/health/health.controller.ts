import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { Client } from 'pg';
import { Public } from '../common/decorators/public.decorator';
import { dlqStore } from '../modules/admin/dlq-store';
import { dlqReadyStatus, type DlqReadyStatus } from './health-dlq';

type ReadyBody = {
  status: 'ok' | 'error';
  postgres: 'up' | 'down';
  redis: 'up' | 'down';
  /** Profundidade DLQ (warn quando >0; nunca causa 503 sozinha — ver health-dlq.ts). */
  dlq: DlqReadyStatus;
};

async function checkPostgres(): Promise<boolean> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore — probe best-effort
    }
  }
}

async function checkRedis(): Promise<boolean> {
  const redis = new Redis(process.env.REDIS_URL ?? '', {
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
  });
  try {
    await redis.connect();
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    try {
      redis.disconnect();
    } catch {
      // ignore — probe best-effort
    }
  }
}

@Controller('health')
export class HealthController {
  // Liveness: sem dependências, sempre 200 se o processo está vivo.
  // @Public: probes (K8s/CI) não autenticam — cadeia APP_GUARD pula.
  @Public()
  @Get('live')
  @HttpCode(200)
  live(): { status: string } {
    return { status: 'ok' };
  }

  // Readiness: 200 só com PG+Redis up; senão 503 com envelope de diagnóstico.
  // Fase 9: checa DATABASE_URL (role app_auth no schema auth via PgBouncer) —
  // cobre 1 banco aurumbit + pooler no caminho; 9 schemas cobertos por
  // backup-check.sh + verify-dbs.sh (não cabe 9 probes no hot path do ready).
  // Fase 6 (aditivo): inclui profundidade DLQ (`dlq.warn` quando há pendentes;
  // warn, nunca 503 sozinha — o replay manual precisa do pod no LB).
  // TODO(Fase 6-hardening): depth real do Redis BullMQ (`Queue.getJobCounts`)
  // por fila `*.dlq`; hoje lê o registro em memória do processo API.
  @Public()
  @Get('ready')
  @HttpCode(200)
  async ready(): Promise<ReadyBody> {
    const [pg, rd] = await Promise.all([checkPostgres(), checkRedis()]);
    const dlq = dlqReadyStatus(dlqStore.depth());
    const body: ReadyBody = {
      status: pg && rd ? 'ok' : 'error',
      postgres: pg ? 'up' : 'down',
      redis: rd ? 'up' : 'down',
      dlq,
    };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}
