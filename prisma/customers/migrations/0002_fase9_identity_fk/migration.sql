-- 0002_fase9_identity_fk — Exceção única ADR-006 §6 (Fase 9).
-- FK cross-schema customers.customer_profiles.identity_id → auth.user_identities(id).
-- Aditiva: só valida órfãos (falha se houver) + ADD CONSTRAINT. Sem
-- reescrever dado. Coluna real é snake_case `identity_id` (ver 0001).
-- Pré-requisito (track E2): schemas `customers` + `auth` no banco único
-- `aurumbit` (nomes resolvidos via search_path = customers + schema
-- qualificado `auth` na referência).
-- Rollback: DROP CONSTRAINT customer_profiles_identityId_fkey; dados intactos.

SET search_path TO customers;

-- Pré-voo: profiles PF órfãos (identity_id preenchido sem match em auth.user_identities.id).
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM customer_profiles p
  LEFT JOIN auth.user_identities u ON u.id = p.identity_id
  WHERE p.identity_id IS NOT NULL AND u.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION '0002_fase9: % customer_profiles orfaos (identity_id sem match em auth.user_identities.id). Limpar antes de aplicar.', orphan_count;
  END IF;
END $$;

ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_identityId_fkey"
  FOREIGN KEY ("identity_id") REFERENCES auth.user_identities("id") ON DELETE RESTRICT ON UPDATE CASCADE;
