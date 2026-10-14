-- 0002_fase8_commercial — Modelo comercial (Fase 8).
-- Aditiva e reversível: colunas nullable/default, sem reescrever dado legado.
-- Rollback: prisma migrate resolve --rolled-back 0002_fase8_commercial.

ALTER TABLE "subscriptions" ADD COLUMN "billingInterval" TEXT;
ALTER TABLE "invoices" ADD COLUMN "billingInterval" TEXT;
-- Fase 8 (fan-out): refs opacas do pedido p/ issue-from-payment sem cross-DB read.
ALTER TABLE "invoices" ADD COLUMN "productId" TEXT;
ALTER TABLE "invoices" ADD COLUMN "planRef" TEXT;
