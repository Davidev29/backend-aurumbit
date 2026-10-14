-- 0002_fase8_commercial — Modelo comercial (Fase 8).
-- No-op intencional: `licenses.features` (snapshot p/ offline-JWT `ch` e
-- entitlements) já existia no schema e entrou no 0001_baseline.
-- Mantido o marco de versão para alinhar os 4 domínios da Fase 8.
-- SELECT ... features FROM licenses (offline-token.service) agora é válido.
SELECT 1;
