import { Pool } from 'pg';

// Token de injeção do pool PG do domínio customers (DATABASE_URL_CUSTOMERS).
// `new Pool()` não conecta de forma ansiosa: seguro no boot/build sem banco.
// Sem DATABASE_URL_CUSTOMERS cai no DATABASE_URL (single-DB `aurumbit` com
// schemas) — mesmo padrão de `auth-pool.provider.ts`.
export const CUSTOMERS_POOL = 'CUSTOMERS_POOL';

export function createCustomersPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL_CUSTOMERS ?? process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}