import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Pool PG ÚNICO do domínio auth (D2-5).
//
// Antes: `PgAuthRepository.db()` e `PgSessionLookup.db()` faziam cada um o seu
// `new Pool({ connectionString: DATABASE_URL_AUTH })` — 2 pools (default `max`
// = 10 cada) contra um `default_pool_size = 20` do PgBouncer, sem folga. Pior:
// sem `max`/`idleTimeoutMillis`/`connectionTimeoutMillis` o `pg` usava
// `connect_timeout = 0` (ESPERA INFINITA por conexão) e não havia
// `statement_timeout`/`query_timeout` — um backend travado deixava o request
// pendurado indefinidamente, sem 503.
//
// Agora: um singleton de processo, exposto como provider Nest `AUTH_POOL`.
// O provider devolve o MESMO singleton de `getSharedAuthPool()`, então injeção
// DI e acesso programático nunca divergem para dois pools. Mesmo formato dos
// pools por domínio já existentes (`access-pool.provider.ts` e
// `licensing-pool.provider.ts`).
// ---------------------------------------------------------------------------

/** Token de injeção do pool PG do domínio auth (DATABASE_URL_AUTH). */
export const AUTH_POOL = 'AUTH_POOL';

/**
 * `max: 10` porque o PgBouncer (`default_pool_size = 20`) é compartilhado por
 * todos os domínios; `connectionTimeoutMillis: 5s` + `statement_timeout`/
 * `query_timeout` garantem que um backend travado vire erro (503 via
 * `PoolTimeout`) em vez de request pendurado para sempre.
 */
export const AUTH_POOL_OPTIONS = {
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  query_timeout: 15_000,
} as const;

/**
 * D2-6: NÃO usamos `options: '-c search_path=auth'`.
 *
 * O `pg` descarta os parâmetros que não estão na allowlist dele da connection
 * string — `?schema=auth` (parâmetro do Prisma) e `?connection_limit=20` são
 * no-op. As alternativas seriam `options` no startup packet ou qualificar as
 * queries, e `deploy/pgbouncer/pgbouncer.ini` roda com `pool_mode = transaction`
 * + `ignore_startup_parameters = ...,search_path,...`: o `options` é aplicado
 * por conexão de SERVIDOR e o PgBouncer reutiliza essas conexões entre clientes,
 * então ele não é confiável como garantia de `search_path`.
 *
 * Decisão: as queries deste domínio são **schema-qualified** (`auth.<tabela>`),
 * que é explícito e independe de `search_path`, de PgBouncer e de o
 * `ALTER ROLE app_auth ... SET search_path = auth` (`deploy/init-consolidated.sql`)
 * ter rodado. O `search_path` do role segue como defesa em profundidade.
 */
export function createAuthPool(connectionString?: string): Pool | null {
  const cs = connectionString ?? process.env.DATABASE_URL_AUTH ?? process.env.DATABASE_URL;
  if (!cs) return null;
  // `new Pool()` não conecta de forma ansiosa: seguro no boot/build sem banco.
  return new Pool({ connectionString: cs, ...AUTH_POOL_OPTIONS });
}

// `undefined` = ainda não resolvido (lazy). Só um pool REAL é memoizado: assim
// um `null` (sem DATABASE_URL_* no momento) não fica preso para o resto do
// processo — os consumidores caem no default-deny e reavaliam depois.
let shared: Pool | null = null;
let sharedResolved = false;
let sharedClosing: Promise<void> | null = null;

/**
 * Pool compartilhado lazy do domínio auth — o MESMO para `PgAuthRepository` e
 * `PgSessionLookup`. Sem `DATABASE_URL_AUTH`/`DATABASE_URL` devolve `null`
 * (default-deny, o comportamento anterior dos dois adaptadores).
 */
export function getSharedAuthPool(): Pool | null {
  if (sharedResolved) return shared;
  shared = createAuthPool();
  sharedResolved = true;
  return shared;
}

/**
 * `pool.end()` no shutdown (D2-5c). Idempotente: o pool é singleton, então
 * AuthModule e o lookup podem sinalizar o shutdown sem duplicar `end()`
 * (o `pg` lança em `end()` duplo).
 */
export async function onAuthPoolShutdown(): Promise<void> {
  if (sharedClosing) return sharedClosing;
  const pool = getSharedAuthPool();
  if (!pool) return;
  sharedClosing = pool
    .end()
    .then(() => undefined)
    .finally(() => {
      // Libera p/ um eventual re-boot do contexto de teste no mesmo processo.
      shared = null;
      sharedResolved = false;
      sharedClosing = null;
    });
  await sharedClosing;
}
