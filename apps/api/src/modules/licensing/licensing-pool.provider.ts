import { Pool } from 'pg';

// Token de injeção do pool PG do domínio licensing (DATABASE_URL_LICENSING).
// Um pool por schema, sem compartilhamento cross-schema. `new Pool()` não conecta
// de forma ansiosa: seguro no boot/build sem banco (falha só no 1º query).
export const LICENSING_POOL = 'LICENSING_POOL';

export function createLicensingPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL_LICENSING,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
