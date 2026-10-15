// deploy/scripts/pgbouncer-forupdate-check.cjs — worker do check h1 (Fase 9 E3).
// 20 transações concorrentes com SELECT ... FOR UPDATE via DSN do app.
// Falha (exit 1) em qualquer erro de pooler/transação. Sem dependências além de `pg`.
const path = require('path');

function loadPg() {
  const roots = [process.env.PGROOT, process.cwd(), path.join(process.cwd(), 'apps', 'api')].filter(Boolean);
  for (const r of roots) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      return require(path.join(r, 'node_modules', 'pg'));
    } catch { /* tenta o proximo */ }
  }
  console.error('SKIP: driver pg indisponivel');
  process.exit(0);
}

const { Client } = loadPg();
const N = Number(process.env.FORUPDATE_N || 20);

async function one(i) {
  const c = new Client({
    connectionString: process.env.TARGET_URL,
    connectionTimeoutMillis: 8000,
    statement_timeout: 5000,
  });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT id FROM licenses LIMIT 1 FOR UPDATE');
    await c.query('SELECT pg_sleep(0.2)');
    await c.query('COMMIT');
  } finally {
    await c.end().catch(() => {});
  }
  return i;
}

(async () => {
  console.log(`FORUPDATE-CHECK: ${N} transacoes concorrentes com SELECT ... FOR UPDATE via pooler`);
  const results = await Promise.allSettled(Array.from({ length: N }, (_, i) => one(i)));
  const fails = results.filter((r) => r.status === 'rejected');
  if (fails.length > 0) {
    console.error(`FAIL: ${fails.length}/${N} transacoes falharam via pooler`);
    fails.slice(0, 5).forEach((f) => console.error('TX-FAIL: ' + (f.reason && f.reason.message)));
    process.exit(1);
  }
  console.log(`FORUPDATE-CHECK PASS (${N}/${N} via pooler, sem erro de prepared/FOR UPDATE)`);
})().catch((e) => {
  console.error('FAIL: ' + (e && e.message));
  process.exit(1);
});
