-- 0003_fase9_indices — Índice do caminho quente check-access (Fase 9 / ADR-006 §8).
-- Aditivo e idempotente (IF NOT EXISTS). Sem reescrever dado.
-- Pré-requisito (track E2): schema `access` no banco único `aurumbit`.
-- Rollback: DROP INDEX IF EXISTS access.idx_entitlements_lookup.
-- NOTA: idx_audit_correlation NÃO vai aqui — vive no init SQL (E2) e é
-- reforçado em prisma/audit/migrations/0002 (track E6).

CREATE INDEX IF NOT EXISTS "idx_entitlements_lookup"
  ON access.entitlements ("ownerId", "productId", "featureCode");
