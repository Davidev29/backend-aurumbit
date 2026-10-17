-- 0003_product_platforms — Plataformas suportadas + modo de entrega do produto.
-- Aditivo e idempotente (IF NOT EXISTS); nao reescreve dado existente.
-- Defaults preservam o comportamento de toda linha ja existente:
--   platforms     = {}            -> produto sem plataforma declarada
--                                  (NAO significa "todas")
--   delivery_mode = 'OFFLINE'    -> opera so no dispositivo (legado)
-- Slugs de `platforms` sao ESTAVEIS: sao os mesmos ids do catalogo de icones
-- (`tools/build-tag-icons.py`) e vao pro banco — nunca renomear sem migracao
-- de dado. Slug fora do catalogo e rejeitado (fail-closed) no service.
--
-- SEM indice em `platforms` (decisao deliberada):
--   - nenhum endpoint filtra por plataforma hoje (`GET /v1/products` filtra
--     somente por `status`) e o catalogo tem poucas linhas;
--   - GIN com array_ops so e usado por `platforms @> ARRAY[...]` / `&&`, e
--     equality (`= ARRAY[...]`) nao aproveita GIN de array;
--   - um GIN aqui custaria escrita em TODO insert/update de produto sem
--     nenhum plano de leitura que o justificasse.
--   Quando existir o filtro "produtos que suportam X", criar o indice junto da
--   migration que introduz o filtro (nao antes):
--     CREATE INDEX IF NOT EXISTS "idx_products_platforms_gin"
--       ON "products" USING GIN ("platforms" array_ops);
--
-- Rollback:
--   ALTER TABLE "products" DROP COLUMN IF EXISTS "delivery_mode";
--   ALTER TABLE "products" DROP COLUMN IF EXISTS "platforms";

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "platforms" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "delivery_mode" TEXT NOT NULL DEFAULT 'OFFLINE';
