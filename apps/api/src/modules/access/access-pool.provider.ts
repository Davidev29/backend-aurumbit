import { Pool } from 'pg';

// Token de injeção do pool PG do domínio access (DATABASE_URL_ACCESS).
// `new Pool()` não conecta de forma ansiosa: seguro no boot/build sem banco.
export const ACCESS_POOL = 'ACCESS_POOL';

export function createAccessPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL_ACCESS,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
