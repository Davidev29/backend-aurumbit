import { Pool } from 'pg';

// Token de injeção do pool PG do domínio audit (DATABASE_URL_AUDIT).
// `new Pool()` não conecta de forma ansiosa: seguro no boot/build sem banco.
// Leitura (SELECT) sobre `audit.audit_events` (só INSERT + SELECT —
// append-only; sem UPDATE/DELETE). Mesmo padrão de BILLING_POOL/FINANCE_POOL.
export const AUDIT_POOL = 'AUDIT_POOL';

export function createAuditPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL_AUDIT,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
