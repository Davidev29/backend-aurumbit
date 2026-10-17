-- 20261017000000 — projection_scope_multi_period.
--
-- Por que: o core/store de projeções guarda UM snapshot por PERÍODO
-- (chave = scope + refDate + premisesHash; scope ∈ monthly|quarterly|annual),
-- mas o 0001_baseline criou `projection_snapshots_scope_key` UNIQUE(scope).
-- O `ON CONFLICT (scope, ref_date, premises_hash)` do store só absorve
-- violação do índice COMPOSTO: o 2º período do mesmo scope (ex. monthly
-- 2026-11 e depois monthly 2026-12) colidiu no índice de `scope` →
-- PG 23505 não interceptado → HTTP 500 no GET /finance/projections.
--
-- O marcador de invalidação do sync (namespace `global | org:<id>`) usava
-- esse mesmo índice como `ON CONFLICT (scope)`; passa a arbitrar pela PK
-- `id`, com id determinístico por namespace (sync.service.ts →
-- applySubscriptionProjection + projectionMarkerIdOf): continua 1 linha
-- por namespace, garantido no banco, sem depender deste índice. O sync
-- continua íntegro mesmo em ambiente onde esta migration ainda não rodou.
--
-- Não destrutivo: DROP INDEX preserva todas as linhas. Permanecem os UNIQUE
-- compostos — o contrato do core (mesmas premissas no mesmo período → mesmo
-- snapshot, idempotente):
--   projection_snapshots_scope_ref_date_premises_hash_key
--   projection_snapshots_orgId_scope_ref_date_premises_hash_key
-- Sem perda de índice p/ o sync: `WHERE scope = $1` passa a ser servido
-- pelo índice composto (coluna líder = scope).
--
-- Rollback: recriar `CREATE UNIQUE INDEX "projection_snapshots_scope_key"
-- ON projection_snapshots("scope")` — seguro só se existir ≤1 linha por
-- scope (validar antes; o próprio SELECT do core volta a dar 23505).

SET search_path TO finance;

DROP INDEX IF EXISTS "projection_snapshots_scope_key";