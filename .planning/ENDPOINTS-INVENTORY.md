# Inventário de Endpoints — Relatório de Arquitetura

> Gerado em 2026-10-10 por leitura direta do código. Sem alteração de código.
> Prefixo global da API: `/v1` (configurado em `apps/api/src/main.ts`).
> BFF Next: `apps/admin/app/api/**/route.ts` — padrão único: se `API_INTERNAL_URL`
> definido faz **proxy** ao Nest repassando `aurum_session`; senão retorna **stub**
> de `@/lib/mocks`. POSTs de escrita repassam/geram `Idempotency-Key`.

## 1. Controllers Nest (`apps/api/src/modules/*/*.controller.ts` + health)

Convenção de auth: salvo indicação, as rotas passam pela cadeia `APP_GUARD`
(JWT + sessão). Guards relevantes: `@Public()` (pula auth), `AdminStubGuard`
(`x-role: admin`), `FinanceReadGuard` (`x-finance-read: <orgId>` / `finance.read`),
`LicenseReadGuard` + `RevealRateLimitGuard` (10/h), `JwtAuthGuard+SessionGuard`,
`@CustomerScope()`, `@RequireMfa()`/`@Roles()` (cadeia pronta, sem uso em rota hoje).

### 1.1 Auth - `@Controller('auth')` - `auth.controller.ts` (15)

| Método | Path (`/v1/auth/...`) | Auth | DTO | O que faz | Idempotência |
|---|---|---|---|---|---|
| POST | `/register` | pública + `@RateLimit('register')` | `RegisterDto` (email, password, consents, deviceLabel) | Cria identidade | não |
| POST | `/verify-email` | pública + rate `verify` | `VerifyEmailDto` (token) | Confirma e-mail | natural (token 1x) |
| POST | `/resend-verification` | pública + rate `recovery` | `ResendVerificationDto` (email) | Reenvia verificação | não |
| POST | `/login` | pública + rate `login` | `LoginDto` (email, password, deviceLabel) | Autentica (pode exigir MFA via ticket) | não |
| POST | `/refresh` | pública (refreshToken body/cookie) + rate `login` | `RefreshDto` (refreshToken, setCookie?) | Roda tokens da família de sessão | não (rotação) |
| POST | `/logout` | `JwtAuthGuard, SessionGuard` | — | Encerra sessão + limpa cookie | sim (logout repetido ok) |
| GET | `/sessions` | `JwtAuthGuard, SessionGuard` | — | Lista sessões da identidade | sim (leitura) |
| DELETE | `/sessions/:id` | `JwtAuthGuard, SessionGuard` | param `id` | Revoga sessão | sim (DELETE) |
| POST | `/forgot` | pública + rate `recovery` | `ForgotDto` (email) | Inicia recuperação de senha | não |
| POST | `/reset` | pública + rate `recovery` | `ResetDto` (token, newPassword) | Redefine senha via token | natural (token 1x) |
| POST | `/change-password` | `JwtAuthGuard, SessionGuard` | `ChangePasswordDto` (current, new) | Troca senha logada | não |
| POST | `/mfa/enroll` | `JwtAuthGuard, SessionGuard` + rate `mfa` | — | Inicia enrollment MFA | não |
| POST | `/mfa/verify` | pública/logada (ticket OU sessão) + rate `mfa` | `MfaVerifyDto` (code, ticket?, deviceLabel?) | Conclui login MFA ou confirma enrollment | não |

### 1.2 Access — leitura quente — `@Controller('access')` — `access.controller.ts` (2)

Pública nesta fase (server-to-server licensing/billing). TODO: service-token/JWT.

| Método | Path | Auth | DTO | O que faz | Idempotência |
|---|---|---|---|---|---|
| GET | `/v1/access/check` | pública (stub) | `CheckAccessQueryDto` | Checagem única de acesso | sim |
| POST | `/v1/access/check-batch` | pública (stub) | `CheckBatchDto` (máx 50 checks) | Checagem em lote | sim |

### 1.3 Access Admin — `@Controller('access')` + `@UseGuards(AdminStubGuard)` — `access-admin.controller.ts` (12)

Todas exigem `x-role: admin` (stub; TODO RBAC real).

| Método | Path | DTO | O que faz | Idempotência |
|---|---|---|---|---|
| POST | `/v1/access/contracts` | `CreateContractDto` | Cria contrato | não |
| GET | `/v1/access/contracts?ownerType=&ownerId=` | query | Lista contratos | sim |
| GET | `/v1/access/contracts/:id` | param | Detalha contrato | sim |
| POST | `/v1/access/contracts/:id/status` | `UpdateContractStatusDto` | Atualiza status do contrato | condicional |
| POST | `/v1/access/contracts/:contractId/items/:itemId/status` | `UpdateItemStatusDto` | Atualiza status do item | condicional |
| GET | `/v1/access/entitlements?...` | query ownerType/ownerId/productId/featureCode/status | Lista entitlements | sim |
| POST | `/v1/access/entitlements` | `UpsertEntitlementDto` | Cria/atualiza entitlement | sim (upsert) |
| POST | `/v1/access/bonus` | `GrantBonusDto` | Concede bônus | não |
| POST | `/v1/access/bonus/:id/revoke` | `RevokeBonusDto` | Revoga bônus | sim (pós 1ª) |
| POST | `/v1/access/adjustments` | `LogAdjustmentDto` | Registra ajuste manual | não (append) |
| GET | `/v1/access/adjustments?targetType=&targetId=` | query | Lista ajustes | sim |
| POST | `/v1/access/admin/evaluate` | — | Gatilho manual do avaliador (agendamento = worker 5min) | sim (recompute) |

### 1.4 Customers — `@Controller('customers')` — `customers.controller.ts` (13)

Identidade stub via header `x-identity-id`; escopo PJ via `X-Org-Id` (deve coincidir com `:orgId`).

| Método | Path | DTO | O que faz | Idempotência |
|---|---|---|---|---|
| GET | `/v1/customers/me` | header identidade | Perfil próprio | sim |
| PATCH | `/v1/customers/me` | `PatchMeDto` | Atualiza perfil | sim |
| POST | `/v1/customers/upgrade-to-pj` | `UpgradeToPjDto` (organizationId, cnpj) | Converte PF→PJ | condicional |
| POST | `/v1/customers/organizations` | `CreateOrganizationDto` (razaoSocial, cnpj) | Cria organização (201) | não |
| GET | `/v1/customers/organizations` | header identidade | Lista orgs do usuário | sim |
| GET | `/v1/customers/organizations/:orgId/members` | escopo org | Lista membros | sim |
| POST | `/v1/customers/organizations/:orgId/members/invite` | `InviteMemberDto` (identityId, role) | Convida membro (201) | não |
| PATCH | `/v1/customers/organizations/:orgId/members/:memberIdentityId` | `UpdateMemberDto` | Atualiza membro | sim |
| DELETE | `/v1/customers/organizations/:orgId/members/:memberIdentityId` | — | Remove membro (204) | sim |
| GET | `/v1/customers/consents` | header identidade | Lista consentimentos LGPD | sim |
| POST | `/v1/customers/consents` | `RecordConsentDto` (purpose, version, status, policyHash) | Registra consentimento (201) | não (append) |
| GET | `/v1/customers/gdpr/export` | header identidade | Exporta dados (LGPD) | sim |
| POST | `/v1/customers/gdpr/anonymize` | header identidade | Anonimiza dados (LGPD) | sim (pós 1ª) |

### 1.5 Billing core — `@Controller('billing')` — `billing.controller.ts` (12)

POSTs aceitam `Idempotency-Key` (replay retorna o existente).

| Método | Path | DTO | O que faz | Idempotência |
|---|---|---|---|---|
| POST | `/v1/billing/customers/sync` | `SyncCustomerDto` | Espelha customer no provider | sim (sync) |
| POST | `/v1/billing/invoices` | `CreateInvoiceDto` + `Idempotency-Key` | Cria fatura | **sim (chave)** |
| GET | `/v1/billing/invoices/:id` | param | Detalha fatura | sim |
| POST | `/v1/billing/invoices/:id/cancel` | `CancelDto` | Cancela fatura | sim (pós 1ª) |
| POST | `/v1/billing/subscriptions` | `CreateSubscriptionDto` + `Idempotency-Key` | Cria assinatura | **sim (chave)** |
| GET | `/v1/billing/subscriptions/:id` | param | Detalha assinatura | sim |
| POST | `/v1/billing/subscriptions/:id/cancel` | `CancelDto` | Cancela assinatura | sim (pós 1ª) |
| POST | `/v1/billing/payments` | `RegisterPaymentDto` + `Idempotency-Key` | Registra pagamento | **sim (chave)** |
| GET | `/v1/billing/payments/:id` | param | Detalha pagamento | sim |
| POST | `/v1/billing/payments/:id/confirm` | `ConfirmPaymentDto` | Hook de aplicação (emite outbox PaymentConfirmed) | sim (pós 1ª) |
| POST | `/v1/billing/payments/:id/refund` | `CreateRefundDto` + `Idempotency-Key` | Cria reembolso | **sim (chave)** |
| GET | `/v1/billing/refunds/:id` | param | Detalha reembolso | sim |

### 1.6 Billing flow — `@Controller('billing')` — `billing-flow.controller.ts` (10)

Admin (`AdminStubGuard`) exceto `webhooks/asaas-mock` (pública, mock/dev; canônica prod = webhook.controller).

| Método | Path | Auth | DTO | O que faz | Idempotência |
|---|---|---|---|---|---|
| POST | `/v1/billing/orders` | admin stub | `CreateOrderDto` | Cria pedido | não |
| POST | `/v1/billing/orders/:id/invoices` | admin stub | — (201) | Fatura pedido | condicional |
| GET | `/v1/billing/orders/:id` | admin stub | — | Detalha pedido | sim |
| POST | `/v1/billing/webhooks/asaas-mock` | pública (mock/dev) | `AsaasWebhookDto` | Simula webhook Asaas (sempre 200) | sim (dedupe receipt) |
| GET | `/v1/billing/outbox` | admin stub | — | Lista outbox | sim |
| GET | `/v1/billing/emails` | admin stub | — | Lista e-mails | sim |
| GET | `/v1/billing/license-hooks` | admin stub | — | Lista hooks de licença | sim |
| GET | `/v1/billing/receipts` | admin stub | — | Lista receipts webhook | sim |
| GET | `/v1/billing/alerts` | admin stub | — | Lista alertas | sim |
| GET | `/v1/billing/metrics` | admin stub | — | Snapshot métricas billing | sim |

### 1.7 Billing webhooks — `@Public() @Controller('billing/webhooks')` — `webhook.controller.ts` (3)

| Método | Path | Auth | O que faz | Idempotência |
|---|---|---|---|---|
| POST | `/v1/billing/webhooks/asaas` | `@Public()` + token `asaas-access-token` timing-safe | Recebe webhook Asaas → `{received, duplicate, eventId}` | **sim (dedupe eventId; sempre 200)** |
| POST | `/v1/billing/webhooks/apply` | `@Public()` + `x-internal-key` (503 fail-closed sem `INTERNAL_WEBHOOK_KEY`) | Worker→API: RECEIVED→VALIDATED→APPLIED | sim (`{applied}` / `externalId` obrigatório) |
| POST | `/v1/billing/webhooks/recon-apply` | `@Public()` + `x-internal-key` | Aplica reconciliação (paymentExternalId, remoteStatus, remoteAmountCents) | sim |

### 1.8 Finance core — `@CustomerScope() @Controller('finance')` — `finance.controller.ts` (14)

Escopo org obrigatório (`x-org-id`). Leitura: `FinanceReadGuard` (`finance.read`);
escrita/baixa: `AdminStubGuard` + read (`finance.manage`, só admin). POSTs aceitam `Idempotency-Key`.

| Método | Path | Auth | DTO | O que faz | Idempotência |
|---|---|---|---|---|---|
| GET | `/v1/finance/overview?from=&to=` | read | `OverviewQueryDto` | Visão geral financeira | sim |
| GET | `/v1/finance/categories` | read | — | Lista categorias | sim |
| GET | `/v1/finance/categories/:id` | read | — | Detalha categoria | sim |
| POST | `/v1/finance/categories` | admin+read | `CreateCategoryDto` | Cria categoria | não |
| GET | `/v1/finance/accounts` | read | — | Lista contas | sim |
| GET | `/v1/finance/accounts/:id` | read | — | Detalha conta | sim |
| POST | `/v1/finance/accounts` | admin+read | `CreateAccountDto` | Cria conta | não |
| GET | `/v1/finance/receivables?...` | read | `FinanceListQueryDto` | Lista recebíveis | sim |
| POST | `/v1/finance/receivables` | admin+read | `CreateReceivableDto` | Cria recebível | não |
| POST | `/v1/finance/receivables/:id/mark-received` | admin+read | `MarkReceivedDto` + `Idempotency-Key` | Baixa recebível | **sim (chave)** |
| GET | `/v1/finance/payables?...` | read | `FinanceListQueryDto` | Lista pagáveis | sim |
| POST | `/v1/finance/payables` | admin+read | `CreatePayableDto` | Cria pagável | não |
| POST | `/v1/finance/payables/:id/mark-paid` | admin+read | `MarkPaidDto` + `Idempotency-Key` | Baixa pagável | **sim (chave)** |
| GET | `/v1/finance/transactions?...` | read | `TransactionListQueryDto` | Extrato realizado | sim |

### 1.9 Finance flow — `@Controller('finance')` — `finance-flow.controller.ts` (13)

Escritas: `AdminStubGuard`. Leituras `balance`/`projections`: `FinanceReadGuard`.
Projeções: HIT→200, MISS→202 COMPUTING (worker + `POST .../compute`).

| Método | Path | Auth | DTO | O que faz | Idempotência |
|---|---|---|---|---|---|
| POST | `/v1/finance/ingest/payment-confirmed` | admin (201) | `IngestPaymentConfirmedDto` (eventId, orgId, externalId, amountCents, paidAt) | Ingere PaymentConfirmed | sim (eventId) |
| POST | `/v1/finance/receivables` | admin (201) | `CreateReceivableDto` | Cria recebível (flow) | não |
| POST | `/v1/finance/receivables/:id/mark-received` | admin | `MarkReceivedDto` (paidAt, eventId) | Baixa recebível (flow) | sim (eventId) |
| POST | `/v1/finance/payables` | admin (201) | `CreatePayableDto` | Cria pagável (flow) | não |
| POST | `/v1/finance/payables/:id/mark-paid` | admin | `MarkPaidDto` (paidAt, eventId) | Baixa pagável (flow) | sim (eventId) |
| GET | `/v1/finance/balance?orgId=` | read | query | Saldo da org | sim |
| GET | `/v1/finance/projections?orgId=&horizonDays=` | read | query | Snapshot projeção (HIT 200 / MISS 202) | sim |
| POST | `/v1/finance/projections/compute` | admin (201) | `ComputeProjectionDto` (orgId, horizonDays) | Computa projeção | sim (recompute) |
| POST | `/v1/finance/grants` | admin (201) | `GrantFinanceReadDto` (orgId, grantee, reason, actorId) | Concede `finance.read` | sim |
| GET | `/v1/finance/grants` | admin | — | Lista grants | sim |
| GET | `/v1/finance/transactions?orgId=` | admin | query | Lista transações (flow) | sim |
| GET | `/v1/finance/audit?action=` | admin | query | Trilha `finance.transaction.posted` / `finance.read.grant` | sim |
| GET | `/v1/finance/metrics` | admin | — | Snapshot métricas finance | sim |

### 1.10 Projeções — `@Controller('finance/projections')` + `FinanceProjectionsGuard` — `projections.controller.ts` (5)

| Método | Path | Auth | O que faz | Idempotência |
|---|---|---|---|---|
| GET | `/v1/finance/projections?scope=monthly\|quarterly\|annual&ref=&tz=` | `finance.read` (`@RequireFinanceScope`) | Lê projeção (hit 200 / miss leve 200 inline / miss pesado 202+jobId) | sim |
| GET | `/v1/finance/projections/jobs/:jobId` | `finance.read` | Polling do job 202 | sim |
| POST | `/v1/finance/projections/recompute` | `finance.manage` (→202) | Invalida + enfileira recompute | sim (recompute) |
| POST | `/v1/finance/projections/internal/compute` | `InternalProjectionKeyGuard` (`x-internal-key`) | Worker computa + upsert snapshot | sim (upsert jobId) |
| POST | `/v1/finance/projections/internal/transaction-posted` | `InternalProjectionKeyGuard` | Invalida snapshots do período (`occurredAt`) | sim |

### 1.11 Finance sync interno — `@Public() @Controller('finance/internal')` — `sync.controller.ts` (1)

| Método | Path | Auth | O que faz | Idempotência |
|---|---|---|---|---|
| POST | `/v1/finance/internal/sync` | `@Public()` + `x-internal-key` (503 sem `INTERNAL_WEBHOOK_KEY`) | Worker→API: aplica envelope outbox billing (`FinanceEnvelope`) | **sim (eventId; replay→200 `{duplicate:true}`, nunca 409)** |

### 1.12 Automação financeira — `@CustomerScope() @Controller('finance')` — `finance-automation.controller.ts` (5) + interna (2)

Despesas via Asaas Bill Payments (boleto 47/convênio 48; 44/outros → manual) com agendamento
automático (vencido = imediato, regra Asaas) + receitas via cobrança automática (PIX/boleto) +
notificações in-system (sino). Filas `finance.bill-pay` / `finance.auto-charge`
(`jobId = finance:*:<idempotencyKey>`, retry 5x + DLQ `finance.dlq`); CAS QUEUED/FAILED→RUNNING
fecha duplo clique/workers concorrentes; provider sempre fora de txn; REGRA DE OURO intacta.

| Método | Path | Auth | DTO | O que faz | Idempotência |
|---|---|---|---|---|---|
| POST | `/v1/finance/expenses` | admin+read | `CreateExpenseDto` + `Idempotency-Key` | Cria despesa; agenda/paga via Asaas quando suportado | **sim (chave; replay→200 existente)** |
| GET | `/v1/finance/expenses/:id/automation` | read | — | Estado do job bill-pay da despesa | sim |
| POST | `/v1/finance/receivables/auto` | admin+read | `CreateAutoReceivableDto` + `Idempotency-Key` | Cria recebível + cobrança Asaas automática (retorna linha digitável) | **sim (chave; replay não recobra)** |
| GET | `/v1/finance/notifications?unread_only=&limit=` | read | query | Lista notificações in-system (+ `unread`) | sim |
| POST | `/v1/finance/notifications/:id/read` | read | — | Marca notificação como lida | **sim (replay retorna a linha)** |
| POST | `/v1/finance/internal/automation/bill-pay` | `@Public()` + `x-internal-key` | `{orgId, idempotencyKey, barcode?, scheduleDate?, description?}` | Worker→API: replay bill-pay (DONE/SCHEDULED/CANCELED→duplicate) | **sim (chave + CAS)** |
| POST | `/v1/finance/internal/automation/auto-charge` | `@Public()` + `x-internal-key` | `{orgId, idempotencyKey, asaasCustomerId?, ...}` | Worker→API: replay auto-charge (DONE→duplicate) | **sim (chave + CAS)** |

### 1.12 Licensing core — `@Controller('licenses')` — `licensing.controller.ts` (8)

Respostas mascaradas; plaintext só em issue (1x) e reveal (auditado).

| Método | Path | Auth | DTO | O que faz | Idempotência |
|---|---|---|---|---|---|
| GET | `/v1/licenses?...` | — (cadeia padrão) | `ListLicensesQueryDto` (ownerType/Id, productId, status) | Lista licenças | sim |
| GET | `/v1/licenses/:id` | — | — | Detalha licença (mascarada) | sim |
| POST | `/v1/licenses` | `AdminStubGuard` | `IssueLicenseDto` | Emite licença (plaintext 1x) | não |
| POST | `/v1/licenses/:id/renew` | `AdminStubGuard` | `RenewLicenseDto` (kind) | Renova licença | condicional |
| POST | `/v1/licenses/:id/suspend` | `AdminStubGuard` | `LicenseReasonDto` (reason) | Suspende | sim (pós 1ª) |
| POST | `/v1/licenses/:id/resume` | `AdminStubGuard` | `LicenseReasonDto` | Retoma | sim (pós 1ª) |
| POST | `/v1/licenses/:id/revoke` | `AdminStubGuard` | `LicenseReasonDto` | Revoga | sim (pós 1ª) |
| POST | `/v1/licenses/:id/reveal` | `RevealRateLimitGuard` (10/h) + `LicenseReadGuard` (`license.read` + MFA se admin) | `RevealLicenseDto` (reason) | Revela chave 1x + trilha `license.reveal` (sem persistir chave) | não (auditado) |

### 1.13 Licenças flow — `@Controller('licenses')` + `AdminStubGuard` — `licenses.controller.ts` (12)

Superfície Fase 3 (stub preservado em `licensing.controller.ts`).

| Método | Path | DTO | O que faz | Idempotência |
|---|---|---|---|---|
| POST | `/v1/licenses` | `IssueLicenseDto` | Emite licença | não |
| GET | `/v1/licenses/:id` | — | Detalha mascarada | sim |
| POST | `/v1/licenses/:id/renew` | `RenewLicenseDto` | Renova | condicional |
| POST | `/v1/licenses/:id/revoke` | `RevokeLicenseDto` | Revoga | sim (pós 1ª) |
| POST | `/v1/licenses/:id/reveal` | `RevealLicenseDto` | Revela plaintext 1x | não (auditado) |
| POST | `/v1/licenses/:id/rotate` | `RotateLicenseDto` | Roda chave (plaintext 1x) | não |
| POST | `/v1/licenses/:id/devices/link` | `LinkDeviceDto` | Vincula device (200) | sim (pós 1ª) |
| POST | `/v1/licenses/:id/devices/unlink` | `UnlinkDeviceDto` | Desvincula (200) | sim (pós 1ª) |
| POST | `/v1/licenses/:id/devices/block` | `BlockDeviceDto` | Bloqueia device (200) | sim (pós 1ª) |
| GET | `/v1/licenses/:id/check?deviceHash=&now=` | query | Checa validade | sim |
| POST | `/v1/licenses/:id/offline-token` | `MintOfflineTokenDto` (+`?now=`) | Emite token offline | condicional |
| POST | `/v1/licenses/offline/check` | `OfflineCheckDto` (200) | Valida token offline | sim |

### 1.14 Devices — `@Controller('licenses')` — `devices.controller.ts` (6)

Cadeia padrão da plataforma; `validate`/offline exigem online. Erros: 404 licença/device,
409 limite/conflito, 403 bloqueado. `validate` retorna **sempre 200** (corpo diz allow/deny; evita retry-storm).

| Método | Path | DTO | O que faz | Idempotência |
|---|---|---|---|---|
| GET | `/v1/licenses/:id/devices` | — | Lista devices | sim |
| POST | `/v1/licenses/:id/devices/link` | `LinkDeviceDto` (deviceHash, appInstanceId, label) (201) | Vincula device (captura IP) | condicional (409 se limite) |
| POST | `/v1/licenses/:id/devices/unlink` | `UnlinkDeviceDto` (200) | Desvincula (resolve hash) | sim |
| POST | `/v1/licenses/:id/devices/rotate` | `RotateDeviceDto` (old/new hash) (200) | Roda device (dual-accept até `dual_accept_until`) | não |
| POST | `/v1/licenses/:id/devices/:hash/block` | `BlockDeviceDto` (reason) (200) | Bloqueia device | sim (pós 1ª) |
| POST | `/v1/licenses/:id/validate` | `ValidateDeviceDto` (deviceHash, ip, country, tokenIat, ctr) (200) | Validação online + anti-clone | sim |

### 1.15 Offline token — `@Controller('licenses')` — `offline-token.controller.ts` (1)

| Método | Path | DTO | O que faz | Idempotência |
|---|---|---|---|---|
| GET | `/v1/licenses/:id/offline-token?device_hash=` | `OfflineTokenQueryDto` | Emite JWT offline (exige device active; 404/403/409) | condicional |

### 1.16 Products — `@Controller('products')` — `products.controller.ts` (5)

Leitura aberta; escrita exige `AdminStubGuard`.

| Método | Path | DTO | O que faz | Idempotência |
|---|---|---|---|---|
| GET | `/v1/products` | — | Lista produtos | sim |
| GET | `/v1/products/:code` | — | Detalha produto | sim |
| POST | `/v1/products` | admin + `CreateProductDto` | Cria produto | não |
| POST | `/v1/products/:code/versions` | admin + `CreateVersionDto` | Adiciona versão | não |
| POST | `/v1/products/:code/archive` | admin | Arquiva produto | sim (pós 1ª) |

### 1.17 Plans — `@Controller('plans')` — `plans.controller.ts` (4)

Preço imutável: só create + archive (sem update de `priceCents`).

| Método | Path | DTO | O que faz | Idempotência |
|---|---|---|---|---|
| GET | `/v1/plans?productCode=&status=` | query | Lista planos | sim |
| GET | `/v1/plans/:code` | — | Plano corrente | sim |
| POST | `/v1/plans` | admin + `CreatePlanDto` | Cria plano | não |
| POST | `/v1/plans/:id/archive` | admin + `ArchivePlanDto` | Arquiva plano | sim (pós 1ª) |

### 1.18 Features — `@Controller('features')` — `features.controller.ts` (2)

| Método | Path | DTO | O que faz | Idempotência |
|---|---|---|---|---|
| GET | `/v1/features?kind=` | query | Lista features | sim |
| POST | `/v1/features` | admin + `CreateFeatureDto` | Cria feature | não |

### 1.19 Communications — `@Controller()` (sem prefixo `/v1`) — `communications.controller.ts` (1)

| Método | Path | Auth | O que faz | Idempotência |
|---|---|---|---|---|
| POST | `/webhooks/resend` (fora do `/v1`; excluído em `main.ts`) | Assinatura Svix se `RESEND_WEBHOOK_SECRET` | Webhook Resend → BOUNCED/COMPLAINED/SENT (`WebhookReceipt` dedupe; `ignored` p/ tipos sem efeito/corpo malformado) | **sim (dedupe webhookId; sempre 200)** |

### 1.20 Health — `@Controller('health')` — `health.controller.ts` (2)

| Método | Path | Auth | O que faz | Idempotência |
|---|---|---|---|---|
| GET | `/health/live` (fora do `/v1`) | `@Public()` | Liveness (sempre 200) | sim |
| GET | `/health/ready` (fora do `/v1`) | `@Public()` | Readiness PG+Redis (200 ou 503 + envelope) | sim |

### 1.21 Audit — `@Controller('audit')` — `audit.controller.ts` (0)

Stub vazio, sem rotas (TODO Fase 2).

> Nota Fase 9 (E0, docs — sem mudança de endpoints): `audit.security_events`
> (particionada como `audit_events`, retenção por `DETACH`) com 6 tipos —
> `LOGIN_FAILED`, `MFA_FAILED`, `TOKEN_ROTATED`, `DEVICE_BLOCKED`,
> `CLONE_SUSPECT`, `KEY_REVEALED` (ver `docs/ADR-006-consolidacao-single-db.md`
> itens 8–9). Payload sem PII (allowlist; `keyMasked` no máximo).

## 2. Rotas Next BFF (`apps/admin/app/api/**/route.ts` — 25)

Todas: **proxy** se `API_INTERNAL_URL` (repasse `aurum_session`), **stub** `mock*` senão.

| Método | Rota BFF | Upstream Nest (proxy) | Stub | O que faz |
|---|---|---|---|---|
| POST | `/api/auth/login` | `POST /v1/auth/login` | `MOCK_ME_ADMIN/MANAGER` + cookies `aurum_session`/`aurum_claims` | Login (sessão httpOnly; manager simula sem `finance.read`) |
| POST | `/api/auth/refresh` | `POST /v1/auth/refresh` | `{ok:true}` / 401 sem sessão | Rotação de sessão |
| GET | `/api/auth/me` | `GET /v1/auth/me` | mock por sessão / 401 | Identidade + permissões (menu) |
| POST | `/api/auth/logout` | (limpa cookie; TODO proxy) | limpa `aurum_session` | Logout BFF |
| POST | `/api/licenses/[id]/reveal` | `POST /v1/licenses/:id/reveal` | `mockLicenseById` | Revelar chave (BFF valida motivo/confirmacao no stub) |
| POST | `/api/licenses/[id]/renew` | `POST /v1/licenses/:id/renew` | `mockLicenseById` | Renovar licença |
| POST | `/api/licenses/[id]/revoke` | `POST /v1/licenses/:id/revoke` | `mockLicenseById` | Revogar licença |
| POST | `/api/licenses/[id]/adjust` | `POST /v1/licenses/:id/adjust` | `mockLicenseById` | Ajuste manual |
| POST | `/api/licenses/[id]/bonus` | `POST /v1/licenses/:id/bonus` | `mockLicenseById` | Conceder bônus |
| GET | `/api/billing/subscriptions` | `GET /v1/billing/subscriptions` | `mockSubscriptionPage` | Lista assinaturas (cursor) |
| POST | `/api/billing/subscriptions/[id]/cancel` | `POST /v1/billing/subscriptions/:id/cancel` (+`Idempotency-Key`) | transição stub + `X-Aurum-Audit` | Cancelar assinatura |
| GET | `/api/billing/invoices` | `GET /v1/billing/invoices` | `mockInvoicePage` | Lista faturas (cursor) |
| GET | `/api/billing/invoices/[id]` | `GET /v1/billing/invoices/:id` (idem) | detalhe mock | Detalha fatura |
| POST | `/api/billing/invoices/[id]/refund` | `POST /v1/billing/invoices/:id/refund` (+`Idempotency-Key`) | `ref-stub-*` + `X-Aurum-Audit` | Estornar fatura paga |
| GET | `/api/billing/audit` | `GET /v1/audit/events?...` | `mockAuditPage` | Trilha append-only (cursor) |
| GET | `/api/finance/summary` | `GET /v1/finance/summary` | `mockFinanceSummary` (+`isStale`) | KPIs + inadimplência |
| GET | `/api/finance/transactions` | `GET /v1/finance/transactions` | `mockTransactionPage` | Extrato realizado |
| GET | `/api/finance/receivables` | `GET /v1/finance/receivables` | `mockReceivablePage` | Lista recebíveis |
| GET | `/api/finance/payables` | `GET /v1/finance/payables` | `mockPayablePage` | Lista pagáveis |
| GET | `/api/finance/projection` | `GET /v1/finance/projection` | `mockProjection` (+`isStale`) | Receita×despesa |
| GET | `/api/finance/facets` | `GET /v1/finance/facets` | `mockFinanceFacets` | Facetas p/ filtros |
| GET | `/api/finance/trace` | `GET /v1/finance/trace` | cadeia mock via `correlationId` | Rastreio charge→audit |
| GET | `/api/finance/export` | `GET /v1/finance/export` (CSV) | `mockFinanceCsv` (`;`, pt-BR) | Export CSV |
| POST | `/api/finance/receivables/[id]/settle` | `POST /v1/finance/receivables/:id/settle` (+`Idempotency-Key`) | `txn-stub-*` + `X-Aurum-Audit` | Baixar recebível |
| POST | `/api/finance/payables/[id]/settle` | `POST /v1/finance/payables/:id/settle` (+`Idempotency-Key`) | `txn-stub-*` + `X-Aurum-Audit` | Pagar pagável |

> Divergências BFF↔Nest a reconciliar: BFF licencia `adjust`/`bonus` e finance
> `summary`/`facets`/`trace`/`export`/`settle`/`projection` apontam p/ upstreams
> sem contraparte exata no Nest (nomes canônicos: `access/bonus`,
> `finance/overview`, `finance/projections`, `mark-received/mark-paid`); `auth/me`
> não existe no Nest (só `sessions`); `billing/invoices` (lista) não existe no Nest
> (só detalhe por id).

## 3. Workers — queues (`apps/workers/src/queues/*.ts`) + crons + DLQs

Padrão global: `jobId = eventId` (dedupe BullMQ), retry exponencial **5x/2s**,
envelope inválido → **DLQ direta** (poison), 404 → DLQ, 5xx/rede → retry;
`removeOnComplete: 1000`, `removeOnFail: 5000`. Workers nunca escrevem PG direto —
aplicam via endpoints internos da API (`x-internal-key`).

| Queue | Arquivo | Produtor → Consumidor interno | DLQ | Cron / ticker |
|---|---|---|---|---|
| `licensing.evaluate` | `licensing.evaluate.ts` + `licensing.queues.ts` | tick → `POST /v1/access/admin/evaluate` | — (retry BullMQ; log) | **repeat 5min** (`EVALUATE_EVERY_MS`, jobId fixo `licensing-evaluate-ticker`) |
| `licensing.sync` | `licensing.sync.ts` | outbox licensing/access (`jobId=eventId`) | `licensing.dlq` (jobId preserva eventId) | — (drenado pelo relay) |
| `communications.send` | `main.ts` (stub) | fanout `payment-confirmed` (`jobId=eventId`, template v1) | — | — (TODO Resend `idempotencyKey=eventId`) |
| `billing.webhook.apply` | `billing.webhook.ts` + `billing.apply.ts` (+`billing.queues.ts`) | webhook/recon (`wh:asaas:*`, `recon:<id>:<data>`) → POST interno API | `billing.dlq` | — |
| `billing.recon` | `billing.recon.ts` | tick reconciliação Asaas (pendentes <7d) | — (log; retry) | **repeat 1h** (jobId `billing-recon-ticker-hourly`; daily 03:00 America/SP 30d = 2º repeat, TODO) |
| `billing.fanout` | `comms.fanout.ts` | `billing.payment.confirmed.v1` → access / licensing / finance (`finance.sync`, `jobId=eventId`) / notifications (`communications.send`) | `billing.fanout.dlq` (métrica) | — |
| `finance.sync` | `finance.sync.ts` + `finance.queues.ts` | outbox billing → `POST /v1/finance/internal/sync` | `finance.dlq` | — |
| `finance.projection.compute` | `finance.projection.ts` (+`finance.queues.ts`) | API 202/recompute (`jobId=scope:ref:hash`) → `POST /v1/finance/projections/internal/compute` | `finance.dlq` (jobId `dlq:<jobId>` preservado) | invalidação safety-net **`setInterval` 60min** (`PROJECTION_INVALIDATION_MS`, env override) → `POST .../internal/transaction-posted`; sem DLQ (reconstrutível) |
| (outbox relay) | `outbox.relay.ts` | `outbox_events` (claim 100 `FOR UPDATE SKIP LOCKED`, `jobId=eventId`, marca published) × 9 domínios (auth, customers, products, access, licensing, billing, finance, audit, communications) | — | **`setInterval` 30s** (TODO pools PG reais; purge 30d = job agendado TODO) |

Métricas: `billing.*` (`billing.metrics.ts`), `finance.*` (`finance.metrics.ts`,
ex. `finance.projection.requested/computed/duplicate/dlq/invalidated`),
`billing.fanout.delivered`.

## Contagem por domínio

| Domínio | Controllers | Endpoints Nest | Rotas BFF | Queues (incl. DLQ) |
|---|---|---|---|---|
| auth | 1 | 15 | 4 | — (via outbox relay) |
| access | 2 | 14 | 0 | — (via outbox relay; avaliador via `licensing.evaluate`) |
| customers | 1 | 13 | 0 | — (via outbox relay) |
| products/plans/features | 3 | 11 | 0 | — (via outbox relay) |
| licensing | 3 registrados (core+devices+offline) + 1 flow isolado | 15 expostas + 12 flow e2e | 5 | 2 + 1 DLQ (`licensing.evaluate/sync/dlq`) |
| billing | 3 | 25 | 6 | 3 + 1 DLQ (`webhook.apply/recon/fanout/dlq`) |
| finance | 4 | 33 | 10 | 2 + 1 DLQ (`finance.sync/projection.compute/dlq`) |
| communications | 1 | 1 | 0 | 1 (`communications.send` stub) |
| audit | 1 (stub, 0 rotas) | 0 | 1 (`billing/audit`→`audit/events`) | — (via outbox relay) |
| health | 1 | 2 | 0 | — |
| outbox relay (infra) | — | — | — | ticker 30s × 9 domínios |
| **Total** | **21 (19 com rotas)** | **145 definidos / 133 expostos** | **28 BFF** | **11 queues (8 trabalho + 3 DLQ) + 4 tickers/crons** |

## Adendo Fase 8 — Modelo comercial (2026-10-14)

Novos endpoints Nest: POST /v1/billing/checkout, GET /v1/billing/checkout/:orderId, GET /v1/billing/internal/issue-context/:paymentId (@Public + x-internal-key), POST /v1/licenses/internal/issue-from-payment (@Public + x-internal-key).

BFF portal: 12/12 rotas com guarda fail-closed `resolveUpstream` (prod sem upstream = 502 UPSTREAM_MISSING); checkout sem stub `done` (PENDING + polling, COMPLETED + licenseId).

Workers: nova queue logica licensing.issue (PaymentConfirmed -> licenca, claim-first por eventId).
