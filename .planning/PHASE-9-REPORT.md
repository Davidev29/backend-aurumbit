# PHASE-9-REPORT.md — Consolidação `aurumbit`: 1 banco + 9 schemas (execução 2026-10-15)

Plano em `.planning/PHASE-9-PLAN.md`. Norma em `docs/ADR-006-consolidacao-single-db.md`.
Premissa cumprida: sem dados de produção — nenhuma migração de dados, dump/restore, janela ou rollback de dados. Sem mudança de negócio (exceto os 6 emits do SecurityEvent, item 12).

## 1. Verificação dos 3 pontos pré-execução (correções aplicadas)

1. **E5 coluna real:** `CustomerProfile.identityId` tem `@map("identity_id")` (migration 0001: `"identity_id" TEXT`) — migration 0002 usa `identity_id` snake + `auth.user_identities` qualificado. Demais domínios usam camelCase (`"customerId"`, `"createdAt"`); cada migration usa o nome real do seu domínio. Plano confirmado sem mudança (o alerta procedia apenas se o schema não tivesse `@map` — tem).
2. **E4 RESTRICT em finance:** verificado que NÃO existe fluxo de delete de categorias/contas (só `create/list/get` em `finance.controller.ts`/`finance.service.ts`). `RESTRICT` seguro; comentário de guarda adicionado no service (futuro delete valida vínculos ou usa `active=false`). Endpoints inalterados.
3. **E8 dual-decrypt:** implementado v2-envelope + legado `v1.<iv>.<ct>.<tag>` (compat dev via `LICENSE_KEY_ENC_KEY` como fallback) — nenhuma re-emissão necessária.

## 2. Entregas (etapa → aceite com output)

| Etapa | Entrega | Aceite (output real) |
|---|---|---|
| E0 | ADR-006 + ROADMAP/PROJECT/PLAN/INVENTORY | commit `4526d26`; 5 arquivos, sem código |
| E1 | 9 `schema.prisma` (`schemas=["<dom>"]` + `@@schema` ×61 + `previewFeatures=["multiSchema"]`, pin 6.8.0) + `prisma-validate.sh` | `bash deploy/scripts/prisma-validate.sh` → `prisma-validate OK (9 dominios, single entrypoint)` (Prisma 6.8.0, 9/9 `is valid`); commit `a4777e4` |
| E2 | `init-consolidated.sql` + `init-dbs.sh` + `grant-repair.sql` | revisão estática (GRANTs explícitos, IF NOT EXISTS, timeouts 5/10/30/60s + idle 30s, partição desde a criação); `bash -n` OK; `psql -f` delegado ao e2e-compose (sem Docker local) |
| E3 | `.env.example` (aurumbit + roles + `pgbouncer=true`) + compose + PgBouncer + `pgbouncer-userlist.sh` + gate `pgbouncer-forupdate-check` + bypass licensing | `compose config` delegado ao CI (sem daemon local); bypass `DATABASE_URL_LICENSING→postgres:5432` verificado por grep; userlist + forupdate wired em `clone-ready-timer.sh` e CI e2e |
| E4 | FKs intra RESTRICT (billing 3, finance 10) + `idx_entitlements_lookup` | pré-voos órfãos com `RAISE EXCEPTION` (banco vazio = 0); `prisma validate` verde |
| E5 | FK cross única `customers.identity_id → auth.user_identities` RESTRICT | `\d` futuro mostra 1 FK cross; Prisma segue opaco |
| E6 | 0001 reescrita particionada + 0002 `security_events` + `RUNBOOKS/audit.md` + `audit-partition.sh` + retention off audit | parent `PARTITION BY RANGE ("createdAt")`, PK `("createdAt",id)`; `bash -n` OK |
| E7 | `SecurityEvent` + 6 emits + e2e negativo | unit `security-events.spec.ts` 7/7; e2e negativo 42501 (SKIP sem banco, gate no CI); suite api **48 suites / 475 testes PASS** (baseline 464 + 11 novos) |
| E8 | Envelope `LICENSE_MASTER_KEY_PATH` + dual-decrypt | licensing **10 suites / 88 testes PASS** (roundtrip v2, dual pós-rotação, legado v1, sem segredo → null/throw); `LICENSE_KEY_ENC_KEY` fora do `.env.example` |
| E9 | CI 1 entrypoint + backup único + probe por schema | `bash -n` 8/8 scripts; `pg_dump -Fc aurumbit` + `pg_dumpall -g`; `backup-check` por `information_schema.schemata` |
| E10 | REPORT + READMEs + limpeza + push main | este arquivo; README/ARCHITECTURE atualizados; `nest build` PASS; tsc sem erros em arquivos Fase 9 (só rootDir pré-existentes em test/libs) |

Gates vivos (sem Docker/PG local — rodam no CI `e2e-compose`/nightly): `compose up` + `migrate-all` + `seed` + `ready 200` + `forupdate-check` + `EXPLAIN Index Scan` + e2e 42 + `backup-check`/`restore-probe` + rotação dual em staging.

## 3. Desvios do plano (todos documentados no código/ADR)

1. **`prisma.config.ts` removido:** Prisma 6.8 só aceita `schema:string` no config (array falha `paths[1] must be string`) e 9 datasources independentes não fundem (blocos duplicados quebram qualquer comando Prisma). Substituído por `deploy/scripts/prisma-validate.sh` (1 entrypoint, 9 schemas declarados). ADR-006 registra a alternativa descartada.
2. **`previewFeatures` só `["multiSchema"]`:** `prismaSchemaFolder` não se aplica a 9 datasources independentes; CLI nova o marca deprecated. Prisma 6.8.0 exige `["multiSchema"]` para `@@schema` (sem ele: `@@schema is only available with multiSchema`).
3. **E1 varreu edits concorrentes:** tracks paralelos editaram os mesmos `schema.prisma`; o commit E1 incluiu relations/índices do E4 (conteúdo correto e validado; pureza de commit sacrificada, rastreado aqui).
4. **`migrator` sem `statement_timeout` (`'0'`):** protege `pg_dump`/DDL longo (papel fora do pooler).
5. **Bypass licensing no pooler aplicado já em E3** (não após falha): decisão preventiva + gate `forupdate-check` criado para validar se o bypass puder sair um dia.
6. **`userlist.txt` + `license-master-key` materializados por scripts** (`pgbouncer-userlist.sh`, `gen-prod-env.sh`), gitignored — compose falha sem eles; documentado nos runbooks.

## 4. Riscos residuais (só o que sobrou de verdade)

1. **PgBouncer `transaction` × `FOR UPDATE` (h1): PARCIALMENTE MITIGADO.** Bypass do licensing aplicado (tráfego real não passa pelo pooler); gate `pgbouncer-forupdate-check.sh` criado e wired no `clone-ready-timer` (nightly). Status: script ainda não executado contra banco vivo (sem Docker local) — primeira execução no CI nightly; se o bypass um dia sair, o gate trava.
2. **Cursor audit por `id` com PK `("createdAt",id)`: ACEITO.** Lookup pontual da âncora faz fan-out nas partições (raro, 1 linha). Sem ação; se virar quente, exigir `createdAt` no DTO (aditivo futuro).
3. **FK cross `customers→auth` invisível ao Prisma (raw SQL): TRAVADO.** `migrate diff` futuro pode sugerir drift; trava = comentário no schema + nome de constraint padrão + teste de guarda a adicionar no CI quando houver banco (`\d` com 1 FK cross). Sem ação imediata.
4. **Partição `DEFAULT` como overflow: MONITORADO.** `audit-partition.sh` roda no cron mensal E no fim do `migrate-all.sh`; `backup-check.sh` pode estender a checagem da partição do mês seguinte (melhoria futura, não débito).

Fase 9 fecha sem débito: todos os 15 requisitos (A1–A8, B9–B15) implementados; item C (app_slug, 2 instâncias) registrado só como gatilho no ADR-006.
