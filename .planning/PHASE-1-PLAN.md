# Fase 1 — Plano (sem código, aguardando revisão)

Objetivo: fundação executável. Nenhum domínio de negócio, só esqueleto + infra validada.

## T1 — Monorepo
- Cria `pnpm-workspace.yaml`, `turbo.json`, `apps/api`, `apps/workers`, `apps/admin`, `libs/*`, `prisma/*`, `deploy/`, `.env.example`, lint/format.
- Dep: nenhuma. Aceite: `pnpm i` limpo, `turbo run build` passa vazio.

## T2 — Nest skeleton api + workers
- `apps/api/src/main.ts` (helmet, cors allowlist, validation, prefix `/v1`), `app.module.ts`, `common/guards/filters/interceptors`, `GET /health/live|ready`.
- `apps/workers/src/main.ts` boot BullMQ vazio.
- Dep: T1. Aceite: `/health/live 200`, `/health/ready` checa PG+Redis (fail 503 se down).

## T3 — Prisma multi-DB mínimo
- 9 `schema.prisma` (1-2 models cada, só `id/createdAt` + `OutboxEvent` onde emite) + `libs/database` factory (1 PrismaClient por DB, output gerado separado).
- `deploy/init-dbs.sh` cria 9 DBs; `deploy/scripts/migrate-all.sh` loop `migrate deploy` ordem fixa, `set -e`.
- Dep: T1. Aceite: `migrate-all.sh` verde do zero, sem FK cross-DB (`grep @relation` cross = fail).

## T4 — Docker Compose local
- `deploy/docker-compose.yml`: api:3000, workers, admin:3001, postgres:16 (9 DBs), redis:7, mailhog:8025.
- `seed-all.sh` popula admin demo + 1 product/plan fake (só p/ smoke, sem regra negócio).
- Dep: T2+T3. Aceite: `compose up --build` sobe 6 serviços healthy.

## T5 — CI mínima + segurança base + obs base
- `ci.yml`: lint→typecheck→unit→build→`prisma validate`+`migrate diff --check`→e2e compose efêmero→trivy.
- `env.schema.ts` zod fail-fast; rate-limit login/recovery/webhook stubs; `libs/observability` pino JSON + `x-correlation-id` + `/metrics`.
- Dep: T2-T4. Aceite: PR fake verde, segredo nenhum no repo (`gitleaks`), `/metrics` expõe `http_requests_total`.

## Dependências
T1 → T2, T1 → T3 → T4; T5 após T2-T4.

## Validação ponta a ponta (aceite Fase 1)
1. `git clone <repo> && cd aurum-bit`
2. `cp .env.example .env`
3. `docker compose -f deploy/docker-compose.yml up --build -d`
4. `pnpm migrate:all`
5. `pnpm seed:all`
6. `curl -f http://localhost:3000/health/ready` → 200 `{"status":"ok","postgres":"up","redis":"up"}`
7. `curl -f http://localhost:3000/health/live` → 200
8. Tempo total <10min máquina limpa; `docker compose logs` sem `FATAL`; CI verde.
- Falha em qualquer passo = Fase 1 reprovada, sem iniciar Fase 2.

## Fora do escopo Fase 1
Auth real, licenças, Asaas/Resend transacional, telas admin (só skeleton Next boot), offline-token, reconciliação. Só stubs/contratos.

## Riscos
- 9 DBs locais pesados → mitigado com 1 Postgres + 9 databases.
- Drift Prisma → mitigado com `migrate diff --check` no CI.
