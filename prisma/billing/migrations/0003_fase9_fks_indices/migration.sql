-- 0003_fase9_fks_indices — FKs intra-schema billing (Fase 9 / ADR-006 §6).
-- Aditiva: só valida órfãos (falha se houver) + ADD CONSTRAINT. Sem
-- reescrever dado, sem DROP de coluna/índice.
-- Pré-requisito (track E2): schemas + tabelas no banco único `aurumbit`
-- (esta migration resolve nomes via search_path = billing).
-- Rollback: DROP CONSTRAINT ..._fkey (3x); dados intactos.

SET search_path TO billing;

-- Pré-voo 1: subscriptions órfãs (customerId sem match em customers.id).
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM subscriptions s
  LEFT JOIN customers c ON c.id = s."customerId"
  WHERE c.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION '0003_fase9: % subscriptions orfas (customerId sem match em billing.customers.id). Limpar antes de aplicar.', orphan_count;
  END IF;
END $$;

-- Pré-voo 2: invoices órfãs (customerId sem match em customers.id).
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM invoices i
  LEFT JOIN customers c ON c.id = i."customerId"
  WHERE c.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION '0003_fase9: % invoices orfas (customerId sem match em billing.customers.id). Limpar antes de aplicar.', orphan_count;
  END IF;
END $$;

-- Pré-voo 3: invoices órfãs (subscriptionId preenchido sem match em subscriptions.id).
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM invoices i
  LEFT JOIN subscriptions s ON s.id = i."subscriptionId"
  WHERE i."subscriptionId" IS NOT NULL AND s.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION '0003_fase9: % invoices orfas (subscriptionId sem match em billing.subscriptions.id). Limpar antes de aplicar.', orphan_count;
  END IF;
END $$;

-- FKs intra-schema (nomes = padrão Prisma p/ zero-drift no migrate diff).
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
