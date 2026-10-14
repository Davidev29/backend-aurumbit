# E2E Report — Aurum Bit API (validação de ponta a ponta, só leitura + execução)

Data (UTC): 2026-10-10 · Alvo: `http://localhost:3000` (stack Docker no ar) · Sem modificação de código-fonte.

## 1. Placar dos testes (real, executado nesta sessão)

| Suíte | Comando | Resultado |
|---|---|---|
| Unit (`apps/api`, jest `src/**/*.spec.ts`) | `npm --prefix apps/api run test` | **35 suites / 377 testes — 100% PASS** (~50 s) |
| E2E (`apps/api/test`, hermético, sem PG/Redis) | `npm --prefix apps/api run test:e2e` | **7 specs / 42 testes — 100% PASS** (~26 s) |

Detalhe unit: 35 suites (auth ×4, billing ×4, licensing ×5, finance ×4, communications ×5,
access ×3, health ×3, security ×2, customers-gdpr, dlq-admin, retention, audit-security,
global-rate-limit). Zero falhas, zero snapshots.

Detalhe e2e: `access.check`, `auth.guards`, `billing.flow`, `finance.flow`, `offline`,
`licensing.flow`, `health` — todos PASS. Observação: o log do `health.e2e-spec` mostra
`GET /health/ready → 503` **dentro do harness** (sem PG/Redis reais) — comportamento
esperado e assertido pelo spec; **no ar (Docker) o mesmo endpoint retorna 200**.

## 2. HTTP ao vivo (status codes reais via `curl.exe`, sem auth)

| # | Requisição | Status | Corpo (resumo) |
|---|---|---|---|
| 1 | `GET /health/live` | **200** | `{"status":"ok"}` |
| 2 | `GET /health/ready` | **200** | `postgres:up, redis:up, dlq.pending:0` |
| 3 | `GET /metrics` | **200** | histogramas `http_requests_total` (só rotas raiz até aqui) |
| 4 | `POST /v1/auth/register {}` | **401** | `UNAUTHORIZED / Token de acesso ausente.` |
| 5 | `POST /v1/auth/login {}` | **401** | idem (guard barra antes da validação do DTO) |
| 6 | `GET /v1/products` | **401** | idem |
| 7 | `GET /v1/plans` / `GET /v1/features` | **401** | idem |
| 8 | `GET /v1/customers/me` | **401** | idem |
| 9 | `GET /v1/finance/overview` / `GET /v1/finance/projections` | **401** | idem |
| 10 | `GET /v1/licenses` / `GET /v1/access/check` | **401** | idem |
| 11 | `GET /v1/billing/payments/p1` | **401** | idem |
| 12 | `GET /v1/admin/dlq` | **401** | idem (esperado sem JWT) |
| 13 | `GET /v1/audit` | **404** | `AuditController` é stub vazio, sem rotas (TODO Fase 2 conhecido) |
| 14 | `GET /admin/queues` sem `x-role` | **403** | stub RBAC exige `x-role: admin` |
| 15 | `GET /admin/queues` com `x-role: admin` | **200** | stub de filas + DLQs |
| 16 | `POST /webhooks/resend {}` (raiz, fora do `/v1`) | **401** | `Token de acesso ausente.` |
| 17 | `POST /v1/finance/internal/sync` | **503** | `sync interno indisponível (INTERNAL_WEBHOOK_KEY não configurado)` |

## 3. Webhook Asaas `POST /v1/billing/webhooks/asaas` (payload stub `{"event":"PAYMENT_CREATED"}`)

| Caso | Status | Corpo | Veredito |
|---|---|---|---|
| Sem header `asaas-access-token` | **401** | `UNAUTHORIZED / Assinatura do webhook inválida.` | Rejeitado (4xx) como esperado |
| Com `asaas-access-token: changeme` | **400** | `BAD_REQUEST / Payload Asaas sem event/id.` | Token passou na comparação; rejeição é só pelo payload stub (4xx) como esperado |
| `POST /v1/billing/webhooks/apply {}` (sem chave interna) | **503** | `apply interno indisponível (INTERNAL_WEBHOOK_KEY não configurado)` | fail-closed por design |

Nota de higiene (sem expor segredos — nenhum valor de env foi lido): o token de teste
`changeme` **foi aceito** (resposta 400 de payload, não 401). Se o ambiente atual usa o
valor default como segredo real, ele deve ser rotacionado para um valor gerado.

## 4. Gaps: cobertura dos testes × exposto no ar

Cobertura existente — unit cobre serviços/transições (billing, finance, licensing, access,
auth pwd/totp/reuse/gdpr, comms, DLQ, health, rate-limit global, security headers/secrets);
e2e cobre fluxos herméticos de access, guards (em **controller de teste**, não no
`AuthController` real), billing, finance, offline/licensing e health.

Rotas **expostas no ar e sem teste HTTP de integração** (nenhum spec sobe o `AppModule`
real — sem prefixo `/v1`, sem cadeia APP_GUARD sobre controllers reais, sem CORS/helmet):

- `POST /v1/auth/*` (register, login, refresh, logout, forgot, reset, verify, mfa…) —
  **nenhum teste HTTP contra o controller real**.
- `GET /v1/products`, `/v1/plans`, `/v1/features` — sem teste.
- `GET/POST/PATCH /v1/customers/*` (só `customers-gdpr.spec` service-level) — sem teste HTTP.
- `*/devices/*`, `*/offline/*` fora do `offline.e2e`/`licensing.flow` — parcial.
- `POST /webhooks/resend` — só `resend-webhook.spec` (parser/assinatura); **nenhum teste do
  controller via HTTP com a cadeia de guards real**.
- `GET /v1/admin/dlq`, `POST :queue/replay`, `GET /admin/queues`, `GET /metrics`,
  `POST /v1/finance/internal/sync`, `POST /v1/billing/webhooks/*` — sem teste de fiação.

## 5. Top 5 priorizado (falhas/gaps)

1. **[CRÍTICO] `POST /v1/auth/*` exige JWT no ar (401) — bootstrap impossível.**
   `AuthController` não tem `@Public()` em nenhuma rota e `JwtAuthGuard` é `APP_GUARD`
   global sem exclusões (`guards.module.ts`). Ninguém consegue registrar/logar contra a
   API no ar. E2E não pega porque testa guards num controller fake. Ação: marcar
   `register/login/refresh/forgot/reset/verify-email/resend-verification/mfa-verify(ticket)`
   como `@Public()` (mantendo `AuthRateLimitGuard`) + e2e de fumaça no `AppModule`.
2. **[CRÍTICO] `POST /webhooks/resend` retorna 401 no ar — Resend nunca entrega.**
   `CommunicationsController` (`POST /webhooks/resend`, fora do `/v1` por design em
   `main.ts`) não tem `@Public()`; o guard global barra o provedor. Status de
   `EmailMessage` (SENT/BOUNCED/COMPLAINED) congela se o envio real estiver ativo.
   Ação: `@Public()` + teste HTTP com cadeia real (assinatura Svix fake).
3. **[ALTO] Container `aurum-admin` em `Restarting`.**
   `docker ps`: api/workers/postgres/redis/mailhog `Up (healthy)`; `aurum-admin`
   `Restarting (1)`. Ação: `docker logs aurum-admin` e corrigir (provável config errada).
4. **[MÉDIO] Pipeline interno morto por `INTERNAL_WEBHOOK_KEY` ausente (503).**
   `POST /v1/billing/webhooks/apply`, `recon-apply` e `POST /v1/finance/internal/sync`
   respondem 503 fail-closed. Por design é correto, mas no env atual worker→API nunca
   aplica recebimentos. Ação: configurar a chave no ambiente (sem commitar) ou documentar
   como indisponibilidade conhecida.
5. **[MÉDIO] E2E hermético diverge do ar; fiação real sem cobertura.**
   Nenhum spec sobe o `AppModule` (prefixo `/v1`, guards sobre controllers reais, CORS,
   helmet, rate-limit global, `rawBody:true`). Foi exatamente isso que deixou #1 e #2
   passarem com 377+42 verdes. Ação: 1 spec de fumaça no `AppModule` (live/ready pública,
   401 em rota protegida, 200/4xx em rotas `@Public`, `/v1` prefix) + e2e do `AuthController`
   real com rate-limit desabilitado.

## 6. O que está OK (sem ação)

- Placar 377/377 + 42/42, `/health/*` e `/metrics` 200 no ar, DLQ `pending:0`.
- Webhook Asaas rejeita sem token (401) e com token + payload inválido (400); `apply`
  interno fail-closed (503) sem a chave — todos 4xx/5xx intencionais, sem vazar motivo.
- `GET /v1/audit → 404`: stub vazio documentado (TODO Fase 2), não é regressão.
- `/health/ready → 503` **só** no harness e2e (sem PG/Redis); no ar é 200. Divergência
  conhecida e assertida, não é falha.
