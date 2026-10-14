-- 0002_fase8_commercial — Channel de capability (Fase 8).
-- Default BOTH = comportamento legado (sem gating por canal).

ALTER TABLE "features" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'BOTH';
