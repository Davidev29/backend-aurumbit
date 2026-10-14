# MAP-REPORT — Mapeamento Arquitetural (código vs docs) — 2026-10-10

> Prefixo Nest `/v1` (`apps/api/src/main.ts:38` exclude `health/live,health/ready,metrics,admin/queues,webhooks/resend`). Pipe global `ValidationPipe{whitelist,forbidNonWhitelisted,transform}`. Docs confrontados: `docs/ARCHITECTURE.md` + `.planning/ENDPOINTS-INVENTORY.md`.

## 1. Módulos `apps/api/src/modules/*` + `apps/workers/src` + infra

| Módulo | Responsabilidade | Guards/Pipes | Emite | Ouve/Consome |
|---|---|---|---|---|
| `auth` (`auth.controller.ts:44`, `auth.service.ts`, `guards.ts`) | Identidade: register/verify/login/refresh rotativo/logout/sessions/forgot/reset/change/mfa + GDPR export/anonymize | `AuthRateLimitGuard` + `@RateLimit`; logadas usam `JwtAuthGuard+SessionGuard` locais (NÃO `common/guards`) | `EmailVerified, SessionRevoked, PasswordChanged` (`auth.service.ts`) | — |
| `customers` (`customers.controller.ts:27`) | PF/PJ, orgs/members, consents, GDPR | Stub `x-identity-id` + `X-Org-Id` deve casar `:orgId`; sem JWT real | `organization.created.v1, membership.granted.v1, consent.recorded.v1, gdpr.erased.v1` | — |
| `products` (`products.controller.ts`, `plans`, `features`, `products.module.ts:13`) | Catálogo imutável products/versions/plans/features | Leitura aberta; escrita `AdminStubGuard(x-role:admin)` | `products.plan.published.v1` | — |
| `access` (`access.module.ts:15` → `AccessController`+`AccessAdminController`) | Verdade de acesso: check/check-batch (cache 60s), contracts/items/entitlements/bonus/adjustments/evaluate | `check*` públicas (server-to-server); admin `AdminStubGuard` | `access.entitlement.updated.v1` + cascata `licensing.*` | `licensing.license.*.v1`, `billing.payment.confirmed.v1` via fanout |
| `licensing` (`licensing.module.ts:12` SÓ `LicensingController` 8 rotas) | Core PG: issue/renew/suspend/resume/revoke/reveal | Lista/detalhe cadeia padrão; mutações `AdminStubGuard`; reveal `RevealRateLimitGuard(10/h)+LicenseReadGuard` | `license.issued/renewed/revoked/suspended/revealed, device.linked/clone_suspect, bonus.granted` | `billing.payment.confirmed` (grant) + cascata `access` |
| ÓRFÃOS licensing (NÃO registrados): `licenses.controller.ts` (12), `devices.controller.ts` (6), `offline-token.controller.ts` (1) | Flow in-memory e2e + devices + offline JWT | `AdminStubGuard` / cadeia padrão | `OfflineTokenIssued.v1`, `device.*` | — (inacessíveis HTTP) |
| `billing` (`billing.module.ts:16` → `BillingController` 12 + `BillingFlowController` 10) + `webhook.module.ts` + `reconcile.module.ts` | Core PG Asaas + flow mock + webhook prod + reconcile | Core sem guard explícito; flow `AdminStubGuard` exceto mock pública; webhook `@Public()` + tokens | `PaymentConfirmed→billing.payment.confirmed.v1`, `InvoiceCancelled, SubscriptionCancelled, RefundRequested`; `payment.failed/refunded, webhook.received, reconciliation.completed` | `webhook ASAAS_*`, `recon:<id>:<data>` |
| `finance` (`finance.module.ts:32` → `FinanceController`14+`FinanceFlowController`13+`FinanceSyncController`1 + `projections.module.ts:19` 5) | Core PG org-scoped + flow in-memory + projections + sync billing→finance | `@CustomerScope()`; leitura `FinanceReadGuard`; escrita `AdminStubGuard+FinanceReadGuard`; sync `@Public()+x-internal-key` | `receivable.received.v1, payable.paid.v1, transaction.posted.v1` (`finance.service.ts:278,415,597`) | `billing.payment.confirmed.v1` envelope |
| `communications` (`communications.controller.ts:14` sem prefixo) | Webhook Resend → BOUNCED/COMPLAINED/SENT | Sem auth (Svix se secret; senão aberto); sempre 200 | `email.requested/delivered/failed` | `billing.payment.confirmed` (fanout) |
| `audit` (controller stub vazio) + `audit.service.ts:16 emit()` | Append-only; intercepta `device.link`, `dlq.*`, `finance.*`, `license.reveal` | — (0 rotas) | `audit.security.event.v1` | Todos via `emit` |
| `admin` (`DlqAdminController`) + `src/admin` | `GET /v1/admin/dlq`, `POST /v1/admin/dlq/:queue/replay` (lógico) + `GET /admin/queues` | `DlqAdminGuard` + audit | `workers.dlq.moved.v1` | — |
| `health` | `GET /health/live\|ready` + `GET /metrics` | `@Public()` | `workers.heartbeat.v1` | — |
| `retention` (sem controllers) | 5 políticas LGPD, dry-run default, batch 500, cron `30 3 * * * America/SP` | Sem HTTP; `RETENTION_CRON_ENABLED=1`, `RETENTION_DRY_RUN=0` p/ real | Métricas `retention.*` | — |
| `common` (guards Jwt→Session→Mfa→Verified→Roles→CustomerScope; rate-limit; outbox relay) | Cadeia global + rate-limit + outbox + correlation-id | `APP_GUARD` ×7 | — | — |
| `workers/src` (`main.ts:61`) | 11 queues + 4 tickers; `jobId=eventId`, retry 5x/2s exp. **STUBS:** `licensing.sync`, `billing.webhook.apply`, `billing.recon`, `outbox.relay` log-only/no-op; só `finance.sync`/`projection.compute` fazem HTTP real | `INTERNAL_WEBHOOK_KEY` + `INTERNAL_PROJECTION_KEY`; sem chave → DLQ/503 | Fanout `toFinance+toNotifications` | Outbox 9 domínios |
| `libs/*` | offline-token HS256 (`off_exp=min(iat+7d,lic_exp+7d)`), events, security (HMAC device, ip_hash 90d), asaas/resend adapters, database, observability, contracts | — | — | — |

## 2. Endpoints HTTP — 145 definidos, ~133 alcançáveis (pós-correções 2026-10-10)

> `*` = órfão (código existe, módulo não registra). `†` = sombreado (flow perde p/ core).

- Auth (15): `POST /v1/auth/register|verify-email|resend-verification|login|refresh|forgot|reset` públicas+rate-limit; `POST logout|mfa/enroll + GET sessions|gdpr/export + DELETE sessions/:id + POST change-password|gdpr/anonymize` JWT+Session; `POST mfa/verify` ticket OU sessão.
- Access: `GET /v1/access/check + POST /v1/access/check-batch` públicas; Admin `POST contracts|.../status|entitlements|bonus|adjustments|admin/evaluate + GET contracts|entitlements|adjustments` (`x-role:admin`).
- Customers (13, `x-identity-id`+`X-Org-Id`): `GET|PATCH me`, `POST upgrade-to-pj|organizations|members/invite|consents|gdpr/anonymize`, `GET organizations|members|consents|gdpr/export`, `PATCH|DELETE members/:id`.
- Products (11): `GET products|products/:code|plans|plans/:code|features` abertas; `POST products|versions|archive|plans|archive|features` admin.
- Licensing CORE (8): `GET /v1/licenses?...|:id`; `POST /v1/licenses|:id/renew|suspend|resume|revoke` admin; `POST :id/reveal` rate-limit+MFA.
- Licensing DEVICES+OFFLINE (7, registradas nas correções 2026-10-10): `GET :id/devices + POST :id/devices/link|unlink|rotate + POST :id/devices/:hash/block + POST :id/validate + GET :id/offline-token`.
- Licensing ÓRFÃ (proposital): `LicensesController` 12 (flow in-memory conflita com o core; e2e isolado) — sem rota.
- Billing core 12: `POST customers/sync|invoices(+Idempotency-Key)|subscriptions|payments|cancel|confirm|refund + GET invoices|subscriptions|payments|refunds/:id`.
- Billing flow 10 (admin exceto mock pública): `POST orders|orders/:id/invoices|webhooks/asaas-mock + GET orders|outbox|emails|license-hooks|receipts|alerts|metrics`.
- Billing webhooks 3 `@Public()`: `POST webhooks/asaas|apply|recon-apply`.
- Finance core 14: `GET overview|categories|accounts|receivables|payables|transactions + POST categories|accounts|receivables|mark-received|payables|mark-paid(+Idempotency-Key)`.
- Finance flow 13†: `POST ingest/payment-confirmed|receivables†|mark-received†|payables†|mark-paid†|projections/compute|grants + GET balance|projections|grants|transactions†|audit|metrics`.
- Projections 5: `GET projections?scope&ref&tz + jobs/:jobId + POST recompute|internal/compute|internal/transaction-posted`.
- Sync 1: `POST /v1/finance/internal/sync` (`x-internal-key`).
- Comms 1: `POST /webhooks/resend` (sempre 200).
- Health 2 + Metrics 1 + DLQ 2 + AdminQueues 1. Audit 0.
- BFF (28 `route.ts`): auth login/refresh/logout/me, licenses reveal/renew/revoke/adjust/bonus, billing subscriptions/cancel/invoices/refund/audit/export, finance summary/transactions/receivables/payables/projection/facets/trace/export/settle, queues/dlq + replay.

## 3. Regras de negócio centrais (ONDE vivem)

- **Compra→Invoice→Payment→Entitlement/License:** `billing-flow.service.ts` (Order→Invoice pending→Asaas); `webhook.transitions.ts:19` (RECEIVED→VALIDATED→APPLIED|REJECTED|DUPLICATE); `billing-transitions.ts:220` (eventos→alvo); `billing.service.ts:338 confirmPayment`; `comms.fanout.ts` (access/licensing/finance/notifications); `access/sync.transitions.ts:139` (entitlements); `finance/sync.service.ts:104` (receivable PREVISTO→RECEBIDO+Transaction).
- **Billing transições:** `billing-transitions.ts:81 AGGREGATE_FLOWS`, `can/assertTransition`, `TERMINAL_STATUSES:55`, `isOutOfOrderRegression:192`, `INV-ano-6dig`; ilegal→422 sem sobrescrever (`billing.service.ts:57`).
- **Finance:** `finance-transitions.ts:44`; saldo SÓ em `markReceived/markPaid` mesma txn (`finance.service.ts:31,272,410`); `Idempotency-Key`+`ON CONFLICT DO NOTHING`; projections HIT200/MISS202 (`projections.service.ts:103,193,246`).
- **Offline 7d:** `libs/offline-token/src/token.ts:57,82,158`; `evaluator.transitions.ts:29` (ACTIVE→GRACE→EXPIRED, +3d); `access-policy.ts:51` (prioridades, REVOKED nunca).
- **Devices/anti-clone:** `devices.service.ts:176` (HMAC), `clone-policy.ts:39` (só sinaliza), `bonus.service.ts:30`.
- **Reconciliação/Outbox:** `reconcile.transitions.ts:13` (hourly+daily 03:00 SP); outbox mesma txn + relay `SKIP LOCKED 100`; `retention.service.ts:14` (dry-run default).

## 4. DIVERGÊNCIAS doc-vs-código

1. Contagem 139 (docs) vs 145 definidos / 133 expostos pós-correções (código). `ARCHITECTURE.md:61` atualizado; `ENDPOINTS-INVENTORY.md:364` ainda reflete pré-correções.
2. Licensing 27 (docs) vs 15 expostos (8 core + 6 devices + 1 offline); flow 12 propositalmente fora (conflito com core).
3. Finance shadowing (core vs flow) admitido no código (`finance.module.ts:21 TODO`), omitido no inventory.
4. Auth 15 (código) vs 13 (docs); BFF 28 (código) vs 25 (docs); upstreams fantasmas sem contraparte Nest.
5. Workers/outbox idealizados nos docs; `main.ts:131,181,206,349` = TODO/log-only (só `finance.sync`+`projection` reais).
6. Guards: docs prometem cadeia JWT→…→CustomerScope; real = guards paralelos + stubs (`x-role:admin`, `x-finance-read`).
7. Projeções duplas (flow vs PG) + `INTERNAL_PROJECTION_KEY` vs `INTERNAL_WEBHOOK_KEY` — docs juntam como `x-internal-key` único.
8. Audit 0 rotas (correto), mas BFF `billing/audit` aponta p/ `audit/events` inexistente → cai em mock.
9. Retenção dry-run default + DLQ replay lógico (`dlq.controller.ts:76 TODO re-enqueue`).
