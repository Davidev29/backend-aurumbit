-- 0003_fase9_fks_indices — FKs intra-schema finance (Fase 9 / ADR-006 §6).
-- Aditiva: só valida órfãos (falha se houver) + DROP das 4 FKs SET NULL
-- legadas + re-ADD RESTRICT + 6 FKs novas RESTRICT. Sem reescrever dado,
-- sem DROP de coluna/índice.
-- Pré-requisito (track E2): schemas + tabelas no banco único `aurumbit`
-- (esta migration resolve nomes via search_path = finance).
-- Rollback: DROP das 10 constraints + re-ADD das 4 originais com
-- ON DELETE SET NULL (ver baseline 0001); dados intactos.

SET search_path TO finance;

-- Pré-voo 1: receivables órfãos (accountId preenchido sem match em financial_accounts.id).
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM receivables r
  LEFT JOIN financial_accounts a ON a.id = r."accountId"
  WHERE r."accountId" IS NOT NULL AND a.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION '0003_fase9: % receivables orfaos (accountId sem match em finance.financial_accounts.id). Limpar antes de aplicar.', orphan_count;
  END IF;
END $$;

-- Pré-voo 2: payables órfãos (accountId preenchido sem match em financial_accounts.id).
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM payables p
  LEFT JOIN financial_accounts a ON a.id = p."accountId"
  WHERE p."accountId" IS NOT NULL AND a.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION '0003_fase9: % payables orfaos (accountId sem match em finance.financial_accounts.id). Limpar antes de aplicar.', orphan_count;
  END IF;
END $$;

-- Pré-voo 3: transactions órfãs (receivableId preenchido sem match em receivables.id).
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM finance_transactions t
  LEFT JOIN receivables r ON r.id = t."receivableId"
  WHERE t."receivableId" IS NOT NULL AND r.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION '0003_fase9: % finance_transactions orfas (receivableId sem match em finance.receivables.id). Limpar antes de aplicar.', orphan_count;
  END IF;
END $$;

-- Pré-voo 4: transactions órfãs (payableId preenchido sem match em payables.id).
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM finance_transactions t
  LEFT JOIN payables p ON p.id = t."payableId"
  WHERE t."payableId" IS NOT NULL AND p.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION '0003_fase9: % finance_transactions orfas (payableId sem match em finance.payables.id). Limpar antes de aplicar.', orphan_count;
  END IF;
END $$;

-- Pré-voo 5: automation jobs órfãos (payableId preenchido sem match em payables.id).
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM finance_automation_jobs j
  LEFT JOIN payables p ON p.id = j."payableId"
  WHERE j."payableId" IS NOT NULL AND p.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION '0003_fase9: % finance_automation_jobs orfaos (payableId sem match em finance.payables.id). Limpar antes de aplicar.', orphan_count;
  END IF;
END $$;

-- Pré-voo 6: automation jobs órfãos (receivableId preenchido sem match em receivables.id).
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM finance_automation_jobs j
  LEFT JOIN receivables r ON r.id = j."receivableId"
  WHERE j."receivableId" IS NOT NULL AND r.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION '0003_fase9: % finance_automation_jobs orfaos (receivableId sem match em finance.receivables.id). Limpar antes de aplicar.', orphan_count;
  END IF;
END $$;

-- Fase 9 (ADR-006 §6): as 4 FKs legadas eram ON DELETE SET NULL (baseline
-- 0001). SET NULL silencioso em categoria/conta corrompe o plano de contas
-- e o extrato — DROP + re-ADD com RESTRICT. Seguro: categorias/contas são
-- append-only (só create/list/get, sem endpoint de DELETE).
ALTER TABLE "receivables" DROP CONSTRAINT IF EXISTS "receivables_categoryId_fkey";
ALTER TABLE "payables" DROP CONSTRAINT IF EXISTS "payables_categoryId_fkey";
ALTER TABLE "finance_transactions" DROP CONSTRAINT IF EXISTS "finance_transactions_accountId_fkey";
ALTER TABLE "finance_transactions" DROP CONSTRAINT IF EXISTS "finance_transactions_categoryId_fkey";

ALTER TABLE "receivables" ADD CONSTRAINT "receivables_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payables" ADD CONSTRAINT "payables_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6 FKs novas intra-schema (nomes = padrão Prisma p/ zero-drift no migrate diff).
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payables" ADD CONSTRAINT "payables_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_receivableId_fkey"
  FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_payableId_fkey"
  FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finance_automation_jobs" ADD CONSTRAINT "finance_automation_jobs_payableId_fkey"
  FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finance_automation_jobs" ADD CONSTRAINT "finance_automation_jobs_receivableId_fkey"
  FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
