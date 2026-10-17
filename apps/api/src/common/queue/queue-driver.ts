/**
 * Driver de fila do `apps/api` (achado N1 da auditoria de 2026-10-17).
 *
 * ANTES: as factories de fila (`billing/webhook.queue.ts`,
 * `finance/{sync,projections,finance-automation}.queue.ts`,
 * `retention/retention.cron.ts`) faziam `require('bullmq')` dentro de try/catch
 * e, como `apps/api` NÃO declarava `bullmq`, todas caíam na fila in-memory —
 * em SILÊNCIO. Em produção a API nunca enfileirava nada e a degradação não
 * deixava rastro (o handler de erro do Redis ainda era `() => undefined`).
 *
 * AGORA a escolha é explícita e registrada, por `QUEUE_DRIVER`:
 * - `memory` (DEFAULT): fila in-memory, nada vai ao Redis. Em produção o boot
 *   emite ERROR exatamente por isso — degradar em silêncio é o que não pode
 *   existir.
 * - `bullmq`: `Queue` real (exige Redis de pé). Se o módulo não puder ser
 *   carregado, o boot FALHA (fail-fast) em vez de degradar.
 *
 * Por que o default é `memory` e não `bullmq`:
 * 1. A decisão registrada D-B ("não ativar o pipeline") é não ligar os
 *    consumidores ainda; ligar só o produtor empilha jobs que ninguém consome
 *    (e que rodariam velhos quando o wiring chegasse).
 * 2. `webhook.service.ts` faz `await queue.add(...)` e a conexão usa
 *    `maxRetriesPerRequest: null`: com o Redis fora, o comando retenta para
 *    sempre e o webhook ficaria PENDURADO em vez de responder 200 — o
 *    contrato prometido é "o ack do webhook NUNCA depende do Redis".
 * Ligar (junto com o wiring dos workers) é decisão operacional, uma variável:
 * `QUEUE_DRIVER=bullmq`.
 */
import { Logger } from '@nestjs/common';

export type QueueDriver = 'memory' | 'bullmq';

export const QUEUE_DRIVERS: readonly QueueDriver[] = ['memory', 'bullmq'];

/** Driver efetivo. Valor inválido falha na hora (`env.schema.ts` barra no boot). */
export function queueDriver(): QueueDriver {
  const raw = (process.env.QUEUE_DRIVER ?? '').trim().toLowerCase();
  if (raw === '') return 'memory';
  if (!(QUEUE_DRIVERS as readonly string[]).includes(raw)) {
    throw new Error(`QUEUE_DRIVER inválido: "${raw}" (esperado: ${QUEUE_DRIVERS.join('|')})`);
  }
  return raw as QueueDriver;
}

/** Única condição em que a degradação para in-memory vira ERROR. */
function isProduction(): boolean {
  return (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
}

const logger = new Logger('QueueDriver');
const announced = new Set<string>();

/**
 * Resolve o driver e registra UMA vez por fila qual está ativo. Nunca
 * silencioso: `memory` fora de produção = log informativo; `memory` em
 * produção = ERROR; `bullmq` = log informativo.
 */
export function announceQueueDriver(scope: string): QueueDriver {
  const driver = queueDriver();
  if (announced.has(scope)) return driver;
  announced.add(scope);
  const detail = JSON.stringify({
    event: 'queue.driver',
    queue: scope,
    driver,
    redis: Boolean(process.env.REDIS_URL),
  });
  if (driver === 'memory' && isProduction()) {
    logger.error(
      `${detail} — em produção NADA é enfileirado; defina QUEUE_DRIVER=bullmq (com Redis) quando os consumidores estiverem ligados`,
    );
  } else if (driver === 'memory') {
    logger.log(`${detail} — fila in-memory (dev/test)`);
  } else {
    logger.log(detail);
  }
  return driver;
}

export type QueueCtor<T> = new (name: string, opts: { connection: unknown }) => T;

/** Carrega `bullmq.Queue`; `null` quando o módulo não resolve. */
export function loadBullMqQueueCtor<T>(): QueueCtor<T> | null {
  try {
    // require lazy: mantém o boot/build possível mesmo com a dep ausente.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('bullmq') as { Queue?: QueueCtor<T> };
    return mod?.Queue ?? null;
  } catch {
    return null;
  }
}

/**
 * Ctor exigido pelo driver `bullmq`: ausente = erro (fail-fast).
 * `bullmq` é dependência real de `apps/api` (declarada em package.json);
 * chegar aqui sem o módulo significa instalação quebrada, não dev sem Redis.
 */
export function requireBullMqQueueCtor<T>(scope: string): QueueCtor<T> {
  const Ctor = loadBullMqQueueCtor<T>();
  if (!Ctor) {
    throw new Error(
      `[queue] QUEUE_DRIVER=bullmq em "${scope}" mas o módulo bullmq não pôde ser carregado`,
    );
  }
  return Ctor;
}

/**
 * Conexão ioredis padrão das filas (lazy: só conecta no 1º comando).
 * O erro era engolido (`() => undefined`); agora o PRIMEIRO erro aparece no log
 * (os seguintes são suprimidos: o ioredis reconecta sozinho e logar cada
 * tentativa inundaria o log).
 */
export function createRedisConnection(scope: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Redis = require('ioredis') as new (
    url: string,
    opts: Record<string, unknown>,
  ) => { on(event: string, cb: (e: unknown) => void): unknown };
  const connection = new Redis(String(process.env.REDIS_URL), {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  let reported = false;
  connection.on('error', (e) => {
    if (reported) return;
    reported = true;
    logger.error(
      JSON.stringify({
        event: 'queue.redis.error',
        queue: scope,
        message: e instanceof Error ? e.message : String(e),
        hint: 'erros seguintes suprimidos (reconexão automática do ioredis)',
      }),
    );
  });
  return connection;
}

/** Reset do registro de anúncios — só para teste. */
export function resetQueueDriverAnnouncements(): void {
  announced.clear();
}
