# Aurum Bit — Arquitetura do Sistema

> Monólito modular NestJS + workers BullMQ + admin Next.js. Postgres único `aurumbit` com 9 schemas por domínio (Fase 9). Outbox + Redis. Asaas Sandbox-first. Resend transacional.

## 1. Visão e estado atual

```
Produtos (Win/Mac/Web/App)
  │ HTTPS / check-access / heartbeat / offline-token
  ▼
API NestJS `apps/api` (:3000, prefixo /v1) ── JWT 15min + refresh rotativo + guards
  │ Prisma 1 client por domínio (9 DATABASE_URL_* no banco `aurumbit`) · FKs intra-schema RESTRICT + exceção única documentada (ADR-006)
  ├─ Postgres :5432 — banco `aurumbit`, 9 schemas: auth, customers, products, access, licensing, billing, finance, audit, communications (+ PgBouncer :6432 transaction)
  ├─ Redis :6379 — BullMQ filas + cache leitura 60s (nunca fonte definitiva)
  ├─ Workers `apps/workers` — consumers BullMQ + crons (sem HTTP, aplicam via API interna x-internal-key)
  ├─ Mailhog :1025/:8025 — SMTP fake local
  └─ Admin Next.js `apps/admin` (:3001) — BFF httpOnly proxy → Nest, fallback mocks
```

**Como está:** Fases 1–9 entregues (Fase 9: banco único `aurumbit` + 9 schemas, ADR-006). Builds api/workers/admin PASS. Unit 475/475, e2e 42/42. Compose config OK. `compose up` requer docker ativo.

## 2. Como os serviços se comunicam

### 2.1 Síncrono (request/response)
- **App → API:** REST `/v1` + `/health/*` + `/webhooks/*` + `/metrics`. JWT Bearer (15min) + SessionGuard (sid ACTIVE) + Mfa/Verified/Roles/CustomerScope. `x-correlation-id` ecoado, `x-org-id` p/ PJ, `Idempotency-Key` em POSTs billing/finance/BFF escrita.
- **Admin → API:** BFF Next `app/api/**` faz proxy com `aurum_session` httpOnly quando `API_INTERNAL_URL` setado, senão stub `lib/mocks`. Cookies `Secure/HttpOnly/SameSite=Lax`. Middleware barra `/financeiro` sem `finance.read`, `/filas` sem `billing.manage`.
- **Workers → API:** HTTP interno `POST .../apply|internal/*` com `x-internal-key` (`INTERNAL_WEBHOOK_KEY`, 503 fail-closed). Workers nunca escrevem PG direto.

### 2.2 Assíncrono (eventos, fonte de verdade transacional)
- **Outbox por domínio:** mesma txn do caso de uso insere `outbox_events (eventId UNIQUE, type, payload sanitizado, correlationId)`. Relay `SKIP LOCKED LIMIT 100` publica BullMQ `jobId=eventId`, marca `published`. Purge 30d.
- **Filas (jobId=eventId, retry 5x exp, DLQ):** `licensing.evaluate` (repeat 5min→POST access evaluate) · `licensing.sync`→`licensing.dlq` · `billing.webhook.apply`→`billing.dlq` · `billing.recon` (1h + daily 03:00 SP) · `billing.fanout`→`billing.fanout.dlq` · `finance.sync`→`finance.dlq` · `finance.projection.compute` (jobId=scope:ref:hash)→`finance.dlq` · `comm.email.send` (idempotencyKey=eventId→Resend) · relay ticker 30s · projeção invalidação 60min.
- **Fluxo canônico compra:** `Order→Invoice pending→Asaas charge→webhook RECEIVED→VALIDATED→APPLIED→Payment CONFIRMED→outbox PaymentConfirmed→fanout→access/licensing (Entitlement+License)→finance (Receivable RECEBIDO+Transaction INCOME)→email payment-confirmed`. Replay = duplicate 200, ilegal = REJECTED + alerta, fora-de-ordem nunca regride terminal.
- **Reconciliação:** hourly (<7d) + daily 30d pagina Asaas, evento sintético `recon:<id>:<data>` pelo mesmo pipeline, divergência → alerta + `billing.recon.*`.

### 2.3 Dados e segurança
- FKs intra-schema `RESTRICT` + exceção única `customers→auth` (ADR-006); demais referências cross-schema opacas + eventos. Chaves licença só `key_hash UNIQUE + prefix/last4 + envelope`, API só `keyMasked`, reveal auditado+MFA+10/h. `device_hash=HMAC(secret,license||instance)`, IP só `ip_hash` 90d + `/24`, sem GPS (geo-IP só memória p/ clone). Audit append-only particionado 5a. E-mail vars 90d, sessão exp+30d, logs 30d.

## 3. Como fazer (operacional)

```bash
cp .env.example .env && bash deploy/scripts/gen-dev-env.sh   # segredos reais (fail-fast D2-4 rejeita TROCAR_*)
docker compose -f deploy/docker-compose.yml up --build -d
bash deploy/scripts/migrate-all.sh        # 9 domínios, set -e
bash deploy/scripts/seed-all.sh
curl -f http://localhost:3000/health/live    # 200
curl -f http://localhost:3000/health/ready    # 200 {postgres,redis,dlq}
curl -f http://localhost:3000/metrics         # http_requests_total
npm --prefix apps/api run build && npm --prefix apps/api run test && npm --prefix apps/api run test:e2e
npm --prefix apps/workers run build && npm --prefix apps/admin run build
```

- **DLQ replay:** `GET /v1/admin/dlq?queue=&page=` + `POST /v1/admin/dlq/:queue/replay {jobId}` (admin+MFA+audit) ou UI `/filas`.
- **Reconciliação manual:** worker recon tick ou `POST /v1/billing/webhooks/recon-apply` interno.
- **Projeções:** `GET /v1/finance/projections?scope=&ref=&tz=` (hit 200 / miss 202+jobId → `GET jobs/:jobId`), `POST recompute` (manage).
- **Reveal chave:** `POST /v1/licenses/:id/reveal {reason}` (license.read+MFA+10/h+audit).
- **Backup:** `bash deploy/scripts/backup-check.sh` (exige 1 DB `aurumbit` + 9 schemas; restore probe semanal).
- **Carga:** `node deploy/load/smoke.js --base http://localhost:3000` (live/ready/metrics + p99 check-access TODO k6).
- **Catálogo de plataformas (fonte única):** editar `libs/contracts/src/products.catalog.json` e rodar `pnpm catalog:sync` (deriva o artefato do contrato; api/admin/portal importam `@aurum-bit/contracts` via `workspace:*` — sem cópia por app); arte nova vai em `ASSETS/tags/*` → `python tools/build-tag-icons.py`. O CI reprova drift, artefato legado por app e ícone órfão com `pnpm catalog:check`.

## 4. Endpoints — o que cada um faz

Prefixo Nest `/v1` (exceto health/webhooks Resend). BFF = proxy-ou-stub. Detalhe completo em `.planning/ENDPOINTS-INVENTORY.md`. Resumo por domínio (145 definidos / 133 expostos Nest + 28 BFF; ver MAP-REPORT p/ órfãos e sombras):

### Auth (15) — identidade global, refresh rotativo, MFA
`POST /v1/auth/register` cria identidade+consents · `verify-email` confirma token 1x · `resend-verification` reenvia genérico · `login` autentica (pode exigir MFA ticket) · `refresh` roda família (reuso revoga) · `logout` encerra · `GET/DELETE sessions` lista/revoga · `forgot/reset` 60min hash-only · `change-password` logado · `mfa/enroll|verify` TOTP · `GET gdpr/export` + `POST gdpr/anonymize` (LGPD).

### Access (14) — verdade de acesso
`GET /v1/access/check` + `POST check-batch(≤50)` (allow/degraded/deny, cache 60s) · admin: contracts CRUD+status, items status, entitlements list/upsert, `bonus` grant/revoke (motivo≥10, vitalícia null), adjustments log, `POST admin/evaluate` manual.

### Customers (13) — PF/PJ + LGPD
`GET/PATCH me` · `upgrade-to-pj` · `POST/GET organizations` · members list/invite/update/remove (último OWNER protegido, X-Org-Id) · consents GET/POST · `gdpr/export|anonymize` (409 com vigência).

### Products/Plans/Features (11) — catálogo imutável
products lista/detalha/cria/versions/archive · plans lista/corrente/cria/archive (sem update preço) · features lista/cria.

### Licensing (15 expostas + 12 flow isolado) — licenças + devices + offline 7d
core: lista/detalha/issue(plaintext 1x)/renew(sem lacuna)/suspend/resume/revoke(tv++)/reveal(auditado) · devices: lista/link/unlink/rotate/block/validate(200 sempre) · `GET :id/offline-token?device_hash=` (device active). `LicensesController` (flow in-memory, 12 rotas) NÃO registrado de propósito — conflita com o core; coberto por e2e isolado. `off_exp=min(iat+7d,expires+7d)`, grace 3d vence offline.

### Billing (25) — Asaas
core: customers/sync, invoices create/get/cancel, subscriptions create/get/cancel, payments register/get/confirm(outbox)/refund, refunds get (Idempotency-Key) · flow mock: orders/invoices/outbox/emails/license-hooks/receipts/alerts/metrics, `webhooks/asaas-mock` · webhooks prod: `POST webhooks/asaas` (token timing-safe, duplicate 200), `apply` + `recon-apply` internos.

### Finance (33) — previsto/pendente/realizado
core: overview, categories/accounts CRUD leitura, receivables/payables lista/cria/`mark-received|mark-paid` (gera Transaction+saldo, idempotente) , transactions extrato (finance.read escopado, manage só admin) · flow: ingest payment-confirmed, balance, projections HIT/MISS, compute, grants finance.read, audit, metrics (sombreadas pelo core e mortas em prod: POST receivables/mark-*, POST payables/mark-*, GET transactions) · projections: GET (hit/miss/202), jobs poll, recompute, internal compute/transaction-posted · `POST internal/sync` worker (eventId duplicate).

### Communications (1) + Health (2) + Audit (0)
`POST /webhooks/resend` (Svix, dedupe, sempre 200) · `GET /health/live|ready` (ready com dlq warn) · audit stub (trilha via BFF `billing/audit`).

### BFF Admin (28) + Workers (11 queues)
BFF: auth login/refresh/me/logout, licenses reveal/renew/revoke/adjust/bonus, billing subscriptions/cancel/invoices/refund/audit, finance summary/transactions/receivables/payables/projection/facets/trace/export/settle — todos proxy-ou-mock com Idempotency-Key. Workers: evaluate 5min, sync, webhook.apply, recon 1h, fanout, finance.sync, projection.compute + 3 DLQ + tickers relay 30s/invalidação 60min.

## 5. Papéis e `finance.read` escopado
admin total+MFA · manager operacional + `billing.read`, `finance.read` só concessão explícita por org (default deny, auditada) · user sem financeiro/bônus. Frontend oculta, backend nega 403. Export segue mesma guarda.
