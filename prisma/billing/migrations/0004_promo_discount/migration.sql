-- Promoção de desconto vinculada à fatura (rastreio).
ALTER TABLE billing.invoices
  ADD COLUMN IF NOT EXISTS "promotionId" TEXT;