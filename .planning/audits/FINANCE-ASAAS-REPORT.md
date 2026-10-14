# Auditoria FINANCEIRO + integração ASAAS — Aurum Bit

Data: 2026-10-10. Escopo: `apps/api/src/modules/billing/*`, `apps/api/src/modules/finance/*`, `libs/asaas-adapter/src/*`, `apps/workers/src/queues/*`, `docs/ARCHITECTURE.md`, `.planning/`. Nenhum valor de segredo é reproduzido aqui.

## 1. Validação do webhook Asaas — RESSALVA
- Timing-safe OK: `timingSafeTokenEqual`/`validateWebhookToken` (`billing/webhook.transitions.ts:56-71`); sem token ou sem segredo → 401/503 fail-closed (`billing/webhook.service.ts:149-159`).
- Dedupe OK: `ON CONFLICT (provider, externalId) DO NOTHING` → 200 duplicate (`billing/webhook.service.ts:118-122,186-189`); `jobId = eventId` (`billing/webhook.queue.ts:31-38`).
- Out-of-order/nunca-regride OK: terminal → idempotente (`webhook.service.ts:244-246`); recon só avança PENDING/FAILED→CONFIRMED/REFUNDED, resto vira divergência (`webhook.service.ts:370-392`, `reconcile.service.ts:169-188`).
- Ressalvas: IP allowlist **fail-open** — lista vazia = permite (`webhook.transitions.ts:86-89`, TODO produção `:73-76`); chave interna `x-internal-key` comparada com `!==` simples, não timing-safe (`billing/webhook.controller.ts:42-44`, `finance/sync.controller.ts:23`); comentários de `rawBody` desatualizados (TODO orquestrador) quando `main.ts:21` já tem `rawBody: true`.

## 2. Idempotência e transições — APROVADO (com nota)
- `Idempotency-Key` nos POSTs billing (`billing.controller.ts:28,43,58,76-81`) e finance baixas (`finance.controller.ts:137,168`); replay retorna existente sem reemitir outbox (`billing.service.ts:110-158,202-233,295-323`; `finance.service.ts:222-298,361-435`).
- Chaves de evento: `ON CONFLICT` em receipts, payments `(provider, externalId)`, transactions `idempotencyKey`, `finance_processed_events(eventId)` (`webhook.service.ts:118-122`; `billing.service.ts:298-308`; `finance.service.ts:253-258`; `finance/sync.service.ts:130-140`).
- Ilegais rejeitadas: `assertTransition`→422 sem sobrescrever (`billing.service.ts:57-81`; `finance.service.ts:50-78`); receipt ilegal→REJECTED+alerta (`webhook.service.ts:247-256,395-422`); amount mismatch→422 (`billing.service.ts:340-351`).
- Nota: `REFUND_STATUSES` (`billing-transitions.ts:49`) não lista `APPROVED`/`REJECTED`, mas o fluxo refund os permite (`:110`) — inconsistência de const; dois mapas de pagamento (`AGGREGATE_FLOWS.payment` `:98-108` vs `PAYMENT_FLOW` `:159-165`) com fallback em `assertPaymentTransition` (`:169-176`).

## 3. Previsto/pendente/realizado + RBAC — RESSALVA
- REGRA DE OURO verificada por grep: só 2 `UPDATE ... balanceCents` no domínio, ambos em `markReceived`/`markPaid` na mesma txn que Transaction+outbox (`finance.service.ts:272-277,409-414`); overview segrega previsto/pendente/realizado/inadimplente, CANCELADO fora da base (`finance.service.ts:504-538`).
- RBAC: leitura exige `finance.read` escopado, escrita `finance.manage`/admin, default deny (`finance.controller.ts:65-185`; `projections.guard.ts:34-68`). Porém **stubs por header**: `FinanceReadGuard` aceita `x-finance-read`/x-role (`finance-read.guard.ts:24-61`, TODO RBAC real `:9-12`); `x-role: admin` sem escopo passa e o `orgOf` cai para query/body (`finance-read.guard.ts:47-50` + `finance.controller.ts:45-61`) — admin stub pode endereçar qualquer org via query param; projections guard com stub `x-role` + TODO (`projections.guard.ts:53-62,17-18`).

## 4. Reconciliação e DLQ+replay — RESSALVA
- Reconciliação real na API: hourly <7d + daily 30d 03:00 SP (`reconcile.transitions.ts:13-21`; `reconcile.cron.ts:31-46`; `reconcile.service.ts:118-235`); evento sintético `recon:<id>:<data>` pelo mesmo pipeline (`reconcile.service.ts:237-255`); divergência→warn+`billing.recon.*`, nunca regride (`reconcile.service.ts:257-268`).
- Porém: cron **desligado por default** (`RECONCILE_CRON_ENABLED=1`, TODO uma-réplica/worker em `reconcile.cron.ts:7-8,48-49`); workers em `main.ts` com billing webhook/recon em **stub** (`workers/main.ts:175-220` — só logam, `listPending: []`, `fetchRemote: null`); o handler real `billing.apply.ts` (retry 5x+DLQ, `dlqJobId` preservando eventId, `:104-132`) **não está wired** (`BILLING_WORKER_WIRING_TODO`, `billing.apply.ts:152-167`); `finance.sync` worker é real (`workers/main.ts:270-288` + `finance.sync.ts:54-127`).
- DLQ+replay é **lógico, não re-enfileira**: `dlq.controller.ts:76-78` TODO re-enqueue real; `dlq-store.ts:7-9,107`.

## 5. Conformidade Asaas sandbox — APROVADO (com nota)
- Base default `https://sandbox.asaas.com/api/v3` + HTTPS obrigatório (`asaas-adapter/config.ts:10,36-39`); auth via header `access_token`, nunca query/log (`adapter.ts:168-176`); retry 1x só transitório, 4xx não retenta (`adapter.ts:26-34,162-213`); erros sanitizados sem chave (`:178-199`).
- Eventos `PAYMENT_CONFIRMED/RECEIVED/REFUNDED/OVERDUE/DELETED` mapeados (`billing-transitions.ts:220-233`, espelho em `webhook.service.ts:64-77`); tópicos outbox versionados `.v1` (`billing-transitions.ts:236-247`; `finance.service.ts:278,415`; `sync.transitions.ts:28-47`).
- Nota: `normalizeAsaasStatus` do recon (`reconcile.transitions.ts:43-59`) não cobre `DELETED`/`EXPIRED`/`AWAITING` — remoto `DELETED` vira `remoto-desconhecido`/divergência e nunca aplica `FAILED`.

## 6. Segredos, `changeme`, TODOs fail-open, logs — REPROVADO
- **`.env` commitado com `ASAAS_API_KEY` de aparência real** (`.env:22`) e `ASAAS_WEBHOOK_SECRET=changeme` (`.env:23`); `.env.example:19-20` com `changeme` (esperado no example). `loadAsaasConfig` é fail-fast p/ `changeme`/ausente na API key (`config.ts:40-43`), mas `webhookSecret` admite `null` (fail-closed só no request path, `:50` + `webhook.service.ts:150-153`).
- Fail-open: allowlist vazia=permite (`webhook.transitions.ts:86-89`); `InternalProjectionKeyGuard` com bypass `NODE_ENV=test` + qualquer `got` truthy (`projections.guard.ts:77-85`); `finance.read` admin stub sem escopo (item 3).
- Logs: sem vazamento de chave encontrado — adapter nunca loga `apiKey`, erros sanitizados (`adapter.ts:178-199`); webhook persiste `rawBody` truncado 20k no receipt (`webhook.service.ts:174-179`, superfície de PII a observar, sem segredo).
- TODOs que adiam segurança/operacional: sweeper dedicado (`webhook.service.ts:193`), `bullmq` em apps/api p/ enqueue real (`webhook.queue.ts:98-112`), outbox relay com pools vazios (`workers/main.ts:339-357`).

## Veredito geral: RESSALVA
Núcleo (transições, idempotência, regra de saldo, sandbox) sólido e bem testado; pendências concentradas em wiring/stubs operacionais, RBAC real e higiene de segredos. Não recomendado ir a produção com `ASAAS_IP_ALLOWLIST` vazia, cron desligado e `.env` com chave real no repo.

## Top 5 problemas (priorizados)
1. `.env` com chave Asaas de aparência real commitado + webhook `changeme` (`.env:22-23`) — rotacionar a chave, remover `.env` do git, exigir `ASAAS_WEBHOOK_SECRET` no boot. [Item 6]
2. Allowlist de IP fail-open em produção (`webhook.transitions.ts:86-89`) — fixar ranges oficiais ou trocar por verificação suportada antes de expor. [Item 1]
3. Workers billing não aplicam de verdade (`workers/main.ts:175-220`; `billing.apply.ts:152-167` não wired) — o pipeline webhook→apply depende hoje só do endpoint interno + recon; wirear ou remover o stub. [Item 4]
4. Replay de DLQ não re-enfileira (`admin/dlq.controller.ts:76-78`) — replay é só marca lógica; documentar como limitação operacional. [Item 4]
5. RBAC financeiro por headers stub (`finance-read.guard.ts:24-61`; `projections.guard.ts:53-62`) com bypass admin-por-query — implementar RolesGuard+membership+audit antes de multitenancy real. [Item 3]
