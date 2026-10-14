-- 0002_fase8_commercial — Snapshot de features por licença (Fase 8).
-- NULL = legado (curinga). Lista [{code, channel}] p/ offline-JWT `ch`
-- e entitlements por feature no consumidor access.

ALTER TABLE "licenses" ADD COLUMN "features" JSONB;
