-- 0002_fase8_commercial — Channel denormalizado (Fase 8).
-- Default BOTH = comportamento legado. UNIQUE 6-col preservada.

ALTER TABLE "entitlements" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'BOTH';
