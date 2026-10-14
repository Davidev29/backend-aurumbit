import { Pool } from 'pg';

// Token de injeção do pool PG do domínio billing (DATABASE_URL_BILLING).
// `new Pool()` não conecta de forma ansiosa: seguro no boot/build sem banco.
export const BILLING_POOL = 'BILLING_POOL';

export function createBillingPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL_BILLING,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
