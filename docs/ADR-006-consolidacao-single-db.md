# ADR-006 — Consolidação single-DB (`aurumbit`, 9 schemas)

- Status: **aceita** (Fase 9 — substitui ROADMAP Fase 9 `app_<slug>`)
- Data: 2026-10-15
- Vincula: `PROJECT.md` (decisões vinculantes), `REQUIREMENTS.md` §§2/4, `.planning/ROADMAP.md` (Fase 9), `.planning/PHASE-9-PLAN.md`, `docs/SLOs.md`, `docs/LGPD.md`, `docs/SECURITY.md`

## Contexto

O ADR-001 decidiu **1 Postgres físico, 9 databases lógicos** (um por domínio) com **sem FK cross-DB**, para isolar domínios e permitir extração futura. Até a Fase 8, o custo superou o benefício: 9 connection strings, 9 `migrate deploy`, 9 pools, backup `9+N`, relay outbox × 9 bancos e listas hardcoded (`migrate-all`, `init-dbs`, `backup-check`). A Fase 9 original previa fragmentar ainda mais (`app_<slug>` por produto); a revisão 2026-10-15 inverte a direção: **consolidar num único banco `aurumbit` com 9 schemas** (um por domínio), mantendo as fronteiras lógicas sem o custo operacional de 9 bancos. Não há dados de produção: a mudança é estrutural, sem migração de dados, sem janela, sem rollback de dados. O sync bidirecional (Fase 10) continua por último e depende destes contratos.

## Decisão

1. **Um banco `aurumbit`, 9 schemas.** Banco lógico único `aurumbit`; um schema por domínio: `auth`, `customers`, `products`, `access`, `licensing`, `billing`, `finance`, `audit`, `communications` (`deploy/init-consolidated.sql`). Fronteira de domínio passa a ser schema + módulo Nest + tópico outbox, não database.
2. **Roles por domínio + `migrator`.** Um role PG por domínio (`app_auth`, `app_customers`, `app_products`, `app_access`, `app_licensing`, `app_billing`, `app_finance`, `app_communications`, `app_audit_append`, `app_audit_read`) mais `app_finance_reports` (só leitura); `GRANT` restrito ao próprio schema + `search_path` travado; role `migrator` (DDL) usada só em migrate; app nunca conecta como superuser.
3. **Timeouts por domínio + idle global.** `statement_timeout`: 5s no caminho crítico (`auth`, `access`, `licensing`, `products`, `customers`), 10s (`billing`, `communications`), 30s (`audit` append + read), 60s (`finance` OLTP + reports); `idle_in_transaction_session_timeout = 30s` global no database. `lock_timeout`: 1s (`access`), 2s (`auth`, `licensing`).
4. **Prisma multiSchema, 9 pastas, validação em 1 entrypoint.** Um `schema.prisma` por domínio em `prisma/<dominio>` (pastas mantidas), cada `datasource` com `schemas = ["<dominio>"]` e `@@schema("<dominio>")` por model/enum, `previewFeatures = ["multiSchema"]` (pin Prisma `6.8.0`; `prismaSchemaFolder` não se aplica — removido após validação: Prisma 6.8 só aceita `schema:string` no config e 9 datasources independentes não fundem). Validação em **uma passada**: `bash deploy/scripts/prisma-validate.sh` declara os 9 schemas num só lugar; `migrate deploy` continua por domínio com ordem topológica fixa no mesmo alvo (`aurumbit`).
5. **PgBouncer em modo `transaction`.** Pool único na frente do `aurumbit` (`deploy/pgbouncer/pgbouncer.ini`, `pool_mode = transaction`); DSNs Prisma com `pgbouncer=true&connection_limit=<n>` por serviço; `migrate`/dump direto no `postgres:5432` (fora do pool); `DATABASE_URL_LICENSING` com bypass direto (transação `FOR UPDATE` validada em E3); `check-access` p99 <50ms (REQUIREMENTS §2) medido através do pool.
6. **FKs intra-schema `RESTRICT`, exceção única, default sem FK cross-schema.** Dentro do mesmo schema, FKs com `ON DELETE RESTRICT` (billing: `subscriptions→customers`, `invoices→customers/subscriptions`; finance: `receivables/payables→financial_accounts`, `finance_transactions→receivables/payables`, `finance_automation_jobs→receivables/payables`), cada uma com pré-voo de órfãos = 0. **Exceção única:** `customers.customer_profiles.identity_id → auth.user_identities(id)` (`RESTRICT`, DDL físico; Prisma mantém o campo opaco). Por padrão, referências entre schemas são por ID lógico opaco + eventos/outbox. Qualquer nova exceção exige ADR + migration dedicada + teste que trave o `RESTRICT`. (Categorias/contas do finance não têm fluxo de delete — só create/list/get — logo `RESTRICT` é seguro; futuro delete deve validar vínculos no service ou usar `active=false`.)
7. **Índices do caminho crítico.** `idx_entitlements_lookup ON access.entitlements("ownerId","productId","featureCode")` (cobre `access-check.service.ts` — `WHERE "ownerType","ownerId","productId","featureCode"`); `idx_audit_correlation ON audit.audit_events(((metadata->>'correlationId')),"createdAt")` (cobre `audit-read.service.ts` — filtro por `correlationId` + `ORDER BY "createdAt",id`). Aceite com `EXPLAIN ANALYZE` = Index Scan.
8. **Audit particionado desde a criação + `DETACH` nunca `DELETE`.** `audit.audit_events` e `audit.security_events` criadas já `PARTITION BY RANGE ("createdAt")` (PK `("createdAt",id)` — exigência PG), partições mensais + `DEFAULT`; retenção 5a (LGPD) por `DETACH` de partição fria com export WORM antes do `DROP`, nunca `DELETE` (`docs/RUNBOOKS/audit.md`, `deploy/scripts/audit-partition.sh` mensal + safety no `migrate-all.sh`); `retention.service` não toca `audit_events`.
9. **SecurityEvent com 6 tipos.** Tabela `audit.security_events` (particionada como `audit_events`), append-only via `app_audit_append` (só `INSERT`; `UPDATE/DELETE` negados por GRANT e travados por e2e negativo): `LOGIN_FAILED`, `MFA_FAILED`, `TOKEN_ROTATED`, `DEVICE_BLOCKED`, `CLONE_SUSPECT`, `KEY_REVEALED`. Sem PII no metadata (allowlist; `keyMasked` no máximo).
10. **Envelope de chave `LICENSE_MASTER_KEY_PATH` + dual-decrypt v1-legado/v2.** `licensing.licenses.key_enc` usa envelope (`license-keys.ts`): DEK por licença cifrada pela master cujo caminho vive em `LICENSE_MASTER_KEY_PATH` (arquivo 0600 via volume `/run/secrets`, nunca a chave no repo/env). Formato novo `v2.<masterVer>.<encDEK>.<iv>.<ct>.<tag>`; leitura com dual-decrypt: tenta v2 (master atual, depois anterior), depois legado `v1.<iv>.<ct>.<tag>` (compat dev); erro → throw (reveal nega). `LICENSE_KEY_ENC_KEY` removido do `.env.example`. Rotação documentada em `docs/SECURITY.md` (K3).
11. **CI 1× + backup único.** Pipeline roda lint → typecheck → test → build → `prisma-validate.sh` (1 entrypoint, 9 schemas) → e2e; backup passa de `9+N` peças para **1 `pg_dump -Fc aurumbit` + `pg_dumpall -g`** (roles), verificação por `information_schema.schemata` + contagens `schema.tabela`.

## Alternativas consideradas

| Alternativa | Por que não (agora) |
|---|---|
| Manter 9 bancos (status quo ADR-001) | Custo operacional permanente (9 strings, 9 migrates, 9 pools, backup `9+N`, relay × 9) sem gatilho de extração ativo; nenhum gatilho do ADR-001 persiste há ≥2 milestones |
| 2 instâncias (quente/fria: access+auth vs resto) | Separação física sem evidência de saturação I/O; dobra compose/prod/backup sem melhorar p99; reavaliar só pelo gatilho abaixo |
| FKs cross-schema amplas (integridade referencial total) | Reacopla domínios no banco e inviabiliza extração futura; catálogo versionado (`ARCHIVED`) e replay `ON CONFLICT` quebrariam; integridade cross-domínio já é garantida por outbox + consumidores idempotentes + reconciliação |
| `prisma.config.ts` com 9 schemas declarados | Inválido no Prisma 6.8 (`schema:string` apenas; 9 datasources independentes conflitam por nomes de bloco duplicados e quebram todo comando Prisma). Substituído por `prisma-validate.sh` (desvio documentado no PHASE-9-REPORT) |

## Consequências

- (+) Operação única: 1 banco, 1 migrate alvo, 1 backup/restore, 1 passada CI; elimina listas hardcoded por banco.
- (+) Isolamento real via roles (antes inexistente: superuser `aurum` via tudo) + caminho quente protegido por timeouts e pool.
- (+) Auditoria escalável desde o dia 1 (particionamento + `DETACH`) e trilha de segurança tipada sem PII.
- (+) Chave de licença fora do env (envelope + rotação dual) e débitos pagos sem adiamento (FKs, índices, SecurityEvent, runbook, envelope, partição).
- (−) Blast radius compartilhado: 1 banco concentra falha operacional (mitigado com roles por schema, timeouts, backup único com restore probe).
- (−) PK do audit vira `("createdAt",id)`: lookup pontual por `id` faz fan-out nas partições (aceito — raro); partição é DDL manual (Prisma não gera).

## Gatilhos (só com motivo concreto — não implementar agora)

- `app_<slug>` (schema/banco dedicado por produto): **só** com demanda de produtos novos que exijam isolamento de dados próprio (ex. segregação regulatória ou tenant dedicado), nunca por padrão. Incluí-lo agora seria código morto = débito novo.
- 2 instâncias (quente/fria): **só** se `check-access` p99 > SLO por saturação de I/O, persistindo por ≥2 milestones, com evidência (`sync_lag_*`/p99 + `EXPLAIN` + saturação I/O documentada no REPORT).
