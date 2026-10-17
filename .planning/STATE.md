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
