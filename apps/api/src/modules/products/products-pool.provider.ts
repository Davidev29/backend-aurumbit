import { Pool } from 'pg';

// Token de injeção do pool PG do domínio products (DATABASE_URL_PRODUCTS).
// Um pool por schema, sem compartilhamento cross-schema. `new Pool()` não conecta
// de forma ansiosa: seguro no boot/build sem banco (falha só no 1º query).
export const PRODUCTS_POOL = 'PRODUCTS_POOL';

export function createProductsPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL_PRODUCTS,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
