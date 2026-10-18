# STATE.md (rev. 2026-10-14)

- Etapa: Fases 1–6 concluídas (builds PASS, unit 377, e2e 42). Nova etapa planejada:
  Fases 7–10 em ROADMAP.md (produção VPS → modelo comercial/capabilities →
  app_<slug> → sync bidirecional). Fase 7 detalhada em PHASE-7-PLAN.md,
  pronta para execução.

- Etapa: new-project revisado, Fase 1 planejada sem código, aguardando revisão do usuário.
- Correções gravadas em PROJECT.md §§1-6:
  1. Offline: `off_exp=min(iat+7d, expires+7d)`; grace 3d vence mesmo offline; validação ALLOW/degradado/DENY explícita.
  2. Chaves: `key_hash` UNIQUE + prefix/last4 + `key_enc` KMS; só `keyMasked`; reveal auditado+MFA+rate-limit.
  3. `finance.read` manager = explícito, escopado por org, default deny (sobrescreve "liberado por padrão").
  4. IP só hash 90d, device_hash licença+12m, sem GPS; geo-IP só memória p/ clone suspect.
  5. Idempotência `UNIQUE(provider,externalId)` + `jobId=eventId`; fora de ordem não regride; reconciliação hourly+daily.
  6. Templates `deposit/withdrawal/order-filled` marcados FORA; 14 templates reais listados.
- Preservado: monólito modular, banco único `aurumbit` com 9 schemas, titular ambos, vigência=pagamento, graça 3d, offline 7d, BullMQ+Outbox, Next.js admin.
- Concluído: Fases 1–6 + ARCHITECTURE.md + README.md. Builds PASS, unit 377, e2e 42.
- Fase 7 executada em 2026-10-14 (report em `.planning/PHASE-7-REPORT.md`):
  código+scripts T0–T8 prontos e verificados localmente (bash -n 15/15, compose
  config semântico, tsc portal, unit api 429/429). Corrigido bug load-bearing:
  `!reset` zerava ports/depends_on no Compose v5.4.0 → `!override`.
  Pendente de VPS/Linux: up real, caddy validate, seed-prod, backup cron,
  smoke --live, clone→ready <10min real, reboot, monitores externos.
- Fase 8 executada em 2026-10-14 (plano `.planning/PHASE-8-PLAN.md`, report
  `.planning/PHASE-8-REPORT.md`): modelo comercial ONE_TIME×MONTH/YEAR,
  kind=lifetime, channel WEB/DESKTOP/BOTH, checkout pós-pagamento real
  (Asaas→licença, sem done sem cobrança), BFF 12/12 fail-closed,
  migrations 0001 (9 domínios) + 0002. Unit api 464/464, worker 5/5,
  builds PASS. Operacional VPS pendente (plano ativo + compra mínima).
- Fase 9 executada em 2026-10-15 (plano `.planning/PHASE-9-PLAN.md`, report
  `.planning/PHASE-9-REPORT.md`, norma `docs/ADR-006-consolidacao-single-db.md`):
  consolidação `aurumbit` (1 banco + 9 schemas, 12 roles, timeouts 5/10/30/60s,
  PgBouncer transaction + bypass licensing, FKs intra RESTRICT + exceção única
  `customers→auth`, índices quentes, audit particionado desde a criação,
  SecurityEvent 6 tipos, envelope `LICENSE_MASTER_KEY_PATH` dual v1/v2,
  CI 1 entrypoint, backup único). Unit api 475/475, worker 5/5, builds PASS.
  Gates vivos (compose/migrate/EXPLAIN/permissões/backup/rotação) no CI e2e/nightly.
- Correção 02 executada em 2026-10-17 (plano `.planning/CORRECTION-PLAN-02-BUILD-GATES-2026-10-17.md`),
  onda T0 — gates de build reais: `pnpm gates:check` (novo: `tools/check-gates.mjs`
  + `tools/gates-matrix.json`) fecha o falso verde do turbo (`<NONEXISTENT>` em
  `typecheck` das 4 apps — o CI checava só as libs); `typecheck` real em api
  (novo `tsconfig.typecheck.json`, `rootDir ../..` mata o TS6059 sem mexer no
  layout de `dist/`), workers, admin e portal; achados do próprio gate:
  `libs/database` era o único pacote sem NENHUM script (dead code, 0 importadores,
  clientes Prisma nunca gerados) → isento de build/typecheck (decisão D-5),
  `asaas-adapter`/`resend-adapter` ganharam `test`, `offline-token` ganhou `lint`.
  Typecheck 12/12 sem fantasma, lint 0 erros, 6 isenções vivas impressas em todo CI.
  Pendente: T1 (fonte única do catálogo + drift gate), T2-T3 (provas/push),
  T4 (workspace + Docker pnpm/prune, dispara com tudo verde), T5 (lint api/workers,
  testes admin/portal, D8-8 test:e2e no CI — que hoje tem 18 falhas pré-existentes).
- Correção 02, onda T1+T2/T3 executada em 2026-10-17 (commits `b52fc27` + docs;
  log completo em `.planning/CORRECTION-EXECUTION-02-2026-10-17.md`): fonte única do
  catálogo em `libs/contracts/src/products.catalog.json` + gerador
  `tools/sync-platform-catalog.mjs` (`pnpm catalog:sync`) → 4 artefatos gerados
  (contrato, borda da API, admin, portal) e `tools/build-tag-icons.py` lendo o mesmo
  JSON — fim das 5 cópias à mão. Gate `pnpm catalog:check` no CI (job lint) reprova
  drift (diff linha-a-linha), PNG faltando/órfão em `public/tags` e fonte inválida
  (exit 2). Controles negativos 6/6 + caso "edita a fonte sem sync"; Python gera os 12
  PNGs byte-idênticos. Semântica intacta (slugs/modos/rótulos idênticos; zero helper
  removido). Typecheck adversarial detecta erro injetado nas 4 apps; portão local
  42/42; api 664/664; contracts 5/5 (primeiro spec de lib). CI verde em `809aa24`
  (9/9 jobs, `e2e-compose-efemero` 2m17s — T0-8 provado) e em `b52fc27` (onda T1).
  Pendente: **D-5** (`libs/database` isento — decidir deletar/ligar), **E-1** (18
  falhas pré-existentes em `test:e2e` do api — destravar antes do T5-3), T4 (Trilha B,
  dispara com tudo verde) e T5.
- Correção 02, onda T4 (Trilha B) executada em 2026-10-17 (branch `feat/t4-workspace-deps-prune`,
  PR próprio; log completo em `CORRECTION-EXECUTION-02` §7): apps api/admin/portal viram
  consumidores reais de `@aurum-bit/contracts` (`workspace:*`) — 3 artefatos gerados por app
  deletados, contrato ganha `MONOCHROME_PLATFORMS`, `turbo test` espera `^build` (dep de
  workspace), jest da api ignora o `dist` do contrato; `catalog:check` passa a cobrar a
  arquitetura (artefato legado reprova, app sem `workspace:*` reprova — 3 controles negativos
  literais). Next: tracing root explícito (`experimental.outputFileTracingRoot` — o top-level
  é ignorado no 14.2) + `apps/admin/package-lock.json` legado (2.393 linhas) removido — ele
  sequestrava o `findRootDir` do Next e quebrava o standalone do admin; standalone aninhado
  com boot 200 nos 2 fronts. Docker: 4 Dockerfiles em pnpm 9 + `turbo prune --docker`
  (binário turbo 2.11.7 pinado + SHA256), `TODO(T1)` morto, vazamento de `*.tsbuildinfo`
  (`.gitignore` fora do contexto Docker → tsc incremental pulava emissão) fechado com
  `.dockerignore` + `find -delete` antes do prune; imagens non-root: api 521MB / workers
  333MB / admin 288MB / portal 318MB. Smoke completo em compose isolado (projeto `t4-smoke`,
  portas/nomes deslocados com `!override`; a stack de dev do dono ficou intacta): 8/8
  containers healthy, `/health/live` + `/health/ready` ok, `/metrics` ok, admin `/login` 200,
  portal `/` 200 com o catálogo renderizado no SSR. Portão local 42/42 (`SUITE_EXIT=0`),
  api 664/664, contracts 5/5. Pendente: **D-5** (decisão do dono), **E-1** (18 falhas
  pré-existentes do `test:e2e` — pré-requisito do T5-3) e **T5** (lint api/workers, vitest
  admin/portal, D8-8 `test:e2e` no CI).
