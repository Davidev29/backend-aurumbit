# PHASE-9-PLAN.md — Consolidação single-DB (`aurumbit`, 9 schemas) — índice E0..E10 (2026-10-15)

> Fonte normativa: `docs/ADR-006-consolidacao-single-db.md`. Sem dados de produção:
> sem migração de dados, sem janela, sem rollback de dados. Fase 10 (sync) continua por último.

## Etapas (uma por commit, aceite antes de avançar)

| Etapa | Escopo (resumo) | Arquivos principais | Aceite |
|---|---|---|---|
| E0 | Docs vinculantes | `docs/ADR-006-*.md`, `.planning/ROADMAP.md`, `.planning/PROJECT.md`, `.planning/PHASE-9-PLAN.md` (este), `.planning/ENDPOINTS-INVENTORY.md` | ADR 11 itens + alternativas + gatilhos; sem código |
| E1 | Prisma base: `schemas=["<dom>"]` + `@@schema` ×61, `previewFeatures=["multiSchema"]` (pin 6.8.0), entrypoint único | `prisma/*/schema.prisma`, `libs/database/package.json`, `deploy/scripts/prisma-validate.sh`, `deploy/scripts/migrate-all.sh` (pin) | `bash deploy/scripts/prisma-validate.sh` → 9/9 válidos (Prisma 6.8.0) |
| E2 | Init consolidado: 1 banco + 9 schemas + 12 roles + GRANTs + timeouts + audit particionado desde a criação | `deploy/init-consolidated.sql`, `deploy/init-dbs.sh`, `deploy/grant-repair.sql` | `psql -f` limpo em banco vazio; `has_schema_privilege` cruzado = f; idle 30s |
| E3 | Env + compose + PgBouncer (transaction) + bypass licensing + teste FOR UPDATE | `.env.example`, `deploy/scripts/gen-prod-env.sh`, `apps/api/src/config/env.schema.ts`, `deploy/docker-compose*.yml`, `deploy/pgbouncer/*` | `compose config --quiet` (base+prod); teste concorrência FOR UPDATE sob pool |
| E4 | FKs intra-schema RESTRICT + índices quentes (billing 3, finance 10, access idx) | `prisma/billing|finance|access/migrations/0003_*/migration.sql` + schemas | pré-voos órfãos = 0; `prisma validate` verde |
| E5 | Exceção cross única `customers.identity_id → auth.user_identities` RESTRICT | `prisma/customers/migrations/0002_*/migration.sql` | 1 FK cross no `\d`; Prisma segue opaco |
| E6 | Audit particionado desde a criação + runbook + cron mensal + transição retention | `prisma/audit/migrations/0001` (reescrita) + `0002`, `docs/RUNBOOKS/audit.md`, `deploy/scripts/audit-partition.sh` | parent particionada; pruning por `createdAt` |
| E7 | SecurityEvent (6 tipos: LOGIN_FAILED, MFA_FAILED, TOKEN_ROTATED, DEVICE_BLOCKED, CLONE_SUSPECT, KEY_REVEALED) + 6 emits + e2e negativo | `prisma/audit/*`, `apps/api/src/modules/audit/security-events.ts`, emits em auth/licensing | unit 7/7; e2e negativo 42501 (com banco) |
| E8 | Envelope `LICENSE_MASTER_KEY_PATH` + dual-decrypt v1-legado/v2 + rotação | `apps/api/src/modules/licensing/license-keys.ts`, `docs/SECURITY.md` | roundtrip v2 + prev + legado v1; sem segredo → null/throw |
| E9 | CI 1 entrypoint + backup único + restore probe por schema | `.github/workflows/*.yml`, `deploy/scripts/{migrate-diff-check,pg-backup,pg-restore-probe,backup-check,verify-dbs,seed-prod}.sh` | `bash -n` 8/8; backup 1 dump + globals |
| E10 | Verificação final + REPORT + READMEs + limpeza | `.planning/PHASE-9-REPORT.md`, READMEs | checklist g (464 unit + 42 e2e + tracers + EXPLAIN + permissões + backup + rotação) |

## Desvios registrados (ver REPORT §desvios)

1. `prisma.config.ts` com array de schemas: inválido no Prisma 6.8 (`schema:string` apenas) — substituído por `deploy/scripts/prisma-validate.sh`.
2. `previewFeatures`: só `["multiSchema"]` (`prismaSchemaFolder` não se aplica a 9 datasources independentes; CLI nova o marca deprecated).
3. `prisma validate` 6.8.0 exige `previewFeatures=["multiSchema"]` para `@@schema` (mantido por isso).

## Gates transversais

- Sem `app_<slug>` e sem 2 instâncias nesta fase (gatilhos no ADR-006 — implementá-los agora seria código morto).
- `retention.service` nunca toca `audit_events`/`security_events` (lifecycle por `DETACH`).
- Categorias/contas do finance sem fluxo de delete (só create/list/get): `RESTRICT` seguro; futuro delete valida vínculos ou usa `active=false`.
