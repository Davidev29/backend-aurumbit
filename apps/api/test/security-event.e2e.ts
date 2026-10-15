// E7 (Fase 9) — negativo append-only de `audit.security_events`.
// O papel da app (`app_audit_append`, só INSERT+SELECT) deve receber 42501
// (insufficient_privilege) em qualquer UPDATE/DELETE na trilha.
// Sem banco (sem DATABASE_URL_AUDIT ou sem DATABASE_URL_AUDIT_APPEND) → skip.
// NOTA: este arquivo segue o nome da etapa (security-event.e2e.ts); o
// testRegex do jest-e2e cobre `*.e2e-spec.ts` — rode com:
//   npx jest --config ./test/jest-e2e.json --runTestsByPath test/security-event.e2e.ts
// ou renomeie p/ `security-event.e2e-spec.ts` p/ entrar no `test:e2e`.
import { Pool } from 'pg';

const AUDIT_URL = process.env.DATABASE_URL_AUDIT;
const APPEND_URL =
  process.env.DATABASE_URL_AUDIT_APPEND ?? process.env.DATABASE_URL_AUDIT_APP;

const canRun = Boolean(AUDIT_URL) && Boolean(APPEND_URL);

// Sem banco/papel append-only → skip condizente (CI sem Postgres).
(canRun ? describe : describe.skip)(
  'security_events append-only (papel app_audit_append)',
  () => {
    let pool: Pool;

    beforeAll(() => {
      pool = new Pool({
        connectionString: APPEND_URL as string,
        connectionTimeoutMillis: 5_000,
      });
    });

    afterAll(async () => {
      await pool?.end();
    });

    it('UPDATE na trilha → 42501', async () => {
      await expect(
        pool.query(
          `UPDATE audit.security_events SET metadata = '{}' WHERE id = 'e2e-noop'`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('DELETE na trilha → 42501', async () => {
      await expect(
        pool.query(
          `DELETE FROM audit.security_events WHERE id = 'e2e-noop'`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  },
);
