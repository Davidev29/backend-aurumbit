import { Pool } from 'pg';

// Token de injeção do pool PG do domínio communications (DATABASE_URL_COMMUNICATIONS).
// Um pool por schema, sem compartilhamento cross-schema. `new Pool()` não conecta
// de forma ansiosa: seguro no boot/build sem banco (falha só no 1º query).
export const COMMUNICATIONS_POOL = 'COMMUNICATIONS_POOL';

export function createCommunicationsPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL_COMMUNICATIONS,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
