import { Pool } from 'pg';

// Token de injeção do pool PG do domínio finance (DATABASE_URL_FINANCE).
// `new Pool()` não conecta de forma ansiosa: seguro no boot/build sem banco.
// Fase 5: mesmo padrão do BILLING_POOL — banco por domínio, sem acesso a
// outros domínios. Billing core e finance core (LedgerEntry/PayoutRequest)
// não são tocados; o sync só usa as tabelas novas (receivables, payables,
// finance_transactions, finance_processed_events, outbox_events,
// projection_snapshots).
export const FINANCE_POOL = 'FINANCE_POOL';

export function createFinancePool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL_FINANCE,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
