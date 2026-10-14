# Runbook — Faturamento (Fase 4)

Fonte normativa: `PROJECT.md` §§5–6, `docs/ADR-004-billing.md`.

Núcleo de cobrança (outro workstream): `BillingService` (`POST /v1/billing/invoices`,
`/subscriptions`, `/payments`, `Idempotency-Key`, `UNIQUE(provider,externalId)`).
Este runbook cobre o fluxo canônico + webhook + reconciliação + DLQ.

## 1. Fluxo canônico

| Passo | Rota | Efeito |
|---|---|---|
| Criar order | `POST /v1/billing/orders` (`x-role: admin`) | Order + Invoice + Payment `PENDING` (externalId `pay_*`). |
| Invoice | `POST /v1/billing/orders/:id/invoices` | Idempotente (retorna a pendente). |
| Webhook Asaas (mock) | `POST /v1/billing/webhooks/asaas` (**pública**) | `RECEIVED → VALIDATED → APPLIED / REJECTED / DUPLICATE`. Sempre 200 (inclusive duplicate/rejected) p/ não gerar retry inútil do provedor. |
| Confirmado | — | Payment `CONFIRMED` + order/invoice `PAID` + outbox `billing.payment.confirmed.v1` (`eventId = billing-payment-confirmed:<externalId>`) + hook de licença `TODO(worker licensing)` + e-mail stub `payment-confirmed` (`idempotencyKey = eventId`). |

`PaymentConfirmed` exige `paidAt + amount` casando; divergência → `REJECTED` + alerta.
Inspeção: `GET /v1/billing/outbox|emails|license-hooks|receipts|alerts|metrics` (admin).

## 2. Webhook: duplicata, ilegal, fora de ordem

- **Replay** (mesmo `provider,externalId,event`) → `DUPLICATE`, sem reemitir outbox,
  sem duplicar licença/e-mail (`UNIQUE(eventId)` + `idempotencyKey=eventId`).
- **Transição ilegal** (ex. `PENDING → REFUNDED`, `CONFIRMED → PENDING`) →
  `REJECTED` + alerta `billing.webhook.rejected`, **sem sobrescrever** o pagamento
  (HTTP 422 no núcleo PG via `assertTransition`; 200+`REJECTED` no webhook mock).
- **Fora de ordem**: evento antigo nunca regride estado terminal
  (`CONFIRMED`/`REFUNDED`); `version/ocurredAt` menor que o armazenado é ignorado.
- **TODO(prod)**: validar assinatura/token do Asaas antes de `RECEIVED` + rate-limit
  por IP (o mock aceita direto; produção exige HMAC + allowlist).

## 3. Reconciliação Asaas (PROJECT.md §5)

- **Hourly**: pendentes `<7d`. **Daily 03:00 America/Sao_Paulo**: janela `30d`.
- Worker `billing.recon` pagina o Asaas (**Sandbox-first**), compara
  `externalId → status/valor` e emite o sintético `recon:<id>:<data>` pelo mesmo
  pipeline (`jobId = eventId`, tópico `billing.reconciliation.completed.v1`).
- **Divergência** valor/estado → alerta + e-mail admin + métricas
  `billing.recon.diverged`. Investigar: `GET /v1/billing/alerts`, receipts no
  Asaas Sandbox, `webhook_receipts` (`UNIQUE(provider,externalId)`).
- Métricas: `billing.webhook.received/applied/duplicate/rejected`,
  `billing.recon.checked/diverged/completed` (`GET /v1/billing/metrics`; prom
  `billingReconTotal` já existe em libs/observability — `billing_webhook_*` no
  dashboard é TODO Fase 5).

## 4. Outbox relay por domínio

- Claim em lote: `SELECT ... WHERE published = false ORDER BY occurredAt ASC
  LIMIT 100 FOR UPDATE SKIP LOCKED` (2 relays nunca publicam o mesmo evento).
- Publica BullMQ com **`jobId = eventId`** (dedupe); marca `published = true`
  **só após** enfileirar (crash antes = republica; consumidor idempotente
  descarta o replay). Domínios: auth, customers, products, access, licensing,
  **billing**, finance, audit, communications (1 DB cada).
- Tick no workers (`outbox.relay`, 30s; **TODO**: injetar Pools reais
  `DATABASE_URL_*` — hoje roda vazio p/ não publicar fantasma).

## 5. DLQ e replay manual

| Fila | Origem | Replay |
|---|---|---|
| `licensing.dlq` | envelope inválido (poison) / attempts esgotados | re-adicionar na `licensing.sync` com o mesmo `eventId` |
| `billing.dlq` | idem (`billing.webhook.apply`) | re-adicionar na `billing.webhook.apply` com o mesmo `jobId = eventId` |

Passos: inspecionar `reason` no job da DLQ → corrigir a causa (API fora, payload
do provedor, bug de transição) → re-adicionar com o **mesmo eventId**
(consumidor idempotente: `ON CONFLICT(eventId)` → `duplicate`, sem duplo
efeito) → confirmar métrica `billing.webhook.applied`/`duplicate`. DLQ
crescendo = consumidor/API fora ou poison em massa: pausar produtor, drenar com
`jobId` preservado.

## 6. Purge 30d (TODO job)

- `DELETE FROM outbox_events WHERE published = true AND occurredAt < now() -
  interval '30 days'`. **Só publicados, só via job agendado** — nunca ad-hoc,
  nunca de não-publicados. Auditoria (`audit_events`, 5a) **não** purga.

## 7. Incidentes comuns

| Sintoma | Causa provável | Ação |
|---|---|---|
| `REJECTED` em massa | mudança de payload do Asaas / evento novo | mapear em `paymentTargetForAsaasEvent`, replay manual |
| `DUPLICATE` alto | retry agressivo do provedor | esperado (200); checar se `APPLIED` correspondente existe |
| Divergência recon | valor/estado fora do PG | conciliar no Sandbox; corrigir via `confirmPayment`/refund, nunca UPDATE direto |
| `billing.dlq` crescendo | API interna fora / poison | §5 |
| E-mail duplicado | `idempotencyKey ≠ eventId` em algum caminho | corrigir p/ `eventId`; Resend dedupa pela chave |
