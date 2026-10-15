# Runbook — Financeiro (Fase 5)

Fonte normativa: `PROJECT.md` §§3/5, `docs/ADR-005-finance.md`, `docs/LGPD.md`.

Núcleo PG (outro workstream): `FinanceService` + `FinanceSyncService`
(`POST /v1/finance/internal/sync`) + `ProjectionsService`
(`GET /v1/finance/projections`, `POST .../recompute`,
`POST .../internal/compute`, `POST .../internal/transaction-posted`).
Este runbook cobre o fluxo hermético/canônico + baixas + projeções (202 e
polling) + DLQ + concessões `finance.read`.

## 1. Fluxo canônico

| Passo | Rota | Efeito |
|---|---|---|
| Fan-out billing → finance | `billing.fanout` → `finance.sync` (`jobId = eventId`) | envelope do outbox billing enfileirado |
| Sync | `POST /v1/finance/internal/sync` (`x-internal-key`) | `PaymentConfirmed` → Receivable `RECEBIDO` + Transaction `INCOME`; replay → `duplicate` (200, nunca 409) |
| Baixa manual recebimento | `POST /v1/finance/receivables/:id/mark-received` (admin, `Idempotency-Key`) | `RECEBIDO` + Transaction `INCOME` + saldo += valor + outbox, mesma txn |
| Baixa manual pagamento | `POST /v1/finance/payables/:id/mark-paid` (admin, `Idempotency-Key`) | `PAGO` + Transaction `EXPENSE` + saldo −= valor + outbox, mesma txn |
| Extrato realizado | `GET /v1/finance/transactions` (`finance.read`) | só Transactions (único mutador de saldo) |

Regra de ouro: `financial_accounts.balanceCents` SÓ é mutado em
`markReceived`/`markPaid`, via FinancialTransaction na mesma transação.
Replay (mesma chave ou título já baixado) retorna o existente sem duplicar,
sem remexer saldo, sem reemitir outbox. Transição ilegal → 422 +
`finance.transition_rejected`, sem sobrescrever (PROJECT.md §5).

## 2. Baixas: previsto/pendente/realizado

- Títulos nascem `PREVISTO`/`PENDENTE` (`POST .../receivables|payables` com
  `status`, `due_date`, `source_type`/`source_id` — replay por
  `(sourceType, sourceId)` retorna o existente).
- `INADIMPLENTE`: sync marca quando `PaymentFailed/Expired` ou
  `InvoiceOverdue` com `dueDate` vencido; `RECEBIDO` nunca regride
  (fora de ordem ignorado + warn `finance.sync.stale-ignored`).
- `RefundCompleted` → Payable `PAGO` + Transaction `EXPENSE`
  (classificação parcial/total em `refundClassification`; o flip do Payment
  no billing é TODO do billing core — escrita cross-schema é proibida).
- Inspeção hermética (sem PG): `GET /v1/finance/balance|metrics|audit`
  do fluxo canônico (`finance.flow.e2e-spec.ts`).

## 3. Projeções: hit/miss, 202 e polling

- `GET /v1/finance/projections?scope=monthly|quarterly|annual&ref=YYYY-MM-DD&tz=America/Sao_Paulo`
  (`finance.read`):
  - hit → **200** `{ cached: true, snapshot }` (match em
    `(scope, refDate, premisesHash)`).
  - miss leve (carga ≤ teto `FINANCE_PROJECTION_INLINE_MAX_INPUTS`, default
    5000) → **200** computado inline.
  - miss pesado → **202** `{ queued: true, jobId, scope, refDate, tz,
    premisesHash }` (`jobId = scope:ref:hash`).
- Polling: `GET /v1/finance/projections/jobs/:jobId` (`finance.read`) →
  `{ status: 'pending'|'done', ... }`; quando `done`, o `GET` passa a 200/hit.
- `POST /v1/finance/projections/recompute` (`finance.manage`, 202): invalida
  snapshots do período + enfileira mês/trimestre/ano correntes.
- `premisesHash = SHA256` das premissas (`projections.compute.ts`): qualquer
  mudança de premissa gera outro `jobId` (sem colisão com o snapshot antigo).
- Worker `finance.projection.compute` consome a fila e chama
  `POST .../internal/compute` (`x-internal-key`); upsert idempotente, replay
  seguro. Métricas `finance.projection.requested/hit/miss/queued/computed/
  failed/invalidated` (+ `computeAvgMs/MaxMs`; alerta se cômputo >500ms:
  `finance.projection.slow_inline`).
- Ticker de invalidação (safety net, 60min default via
  `FINANCE_PROJECTION_INVALIDATION_MS`): `POST
  .../internal/transaction-posted { occurredAt }` invalida snapshots do
  período corrente; a invalidação primária é por evento (a cada
  `FinanceTransactionPosted` + `SubscriptionActivated/Cancelled`).

## 4. DLQ e replay manual

| Fila | Origem | Replay |
|---|---|---|
| `finance.dlq` | `finance.sync`: envelope inválido (poison) / attempts esgotados | re-adicionar na `finance.sync` com o mesmo `jobId = eventId` |
| `finance.dlq` | `finance.projection.compute`: envelope inválido / attempts esgotados | re-adicionar na `finance.projection.compute` com o mesmo `jobId = scope:ref:hash` |

Passos: inspecionar `reason` no job da DLQ → corrigir a causa (API fora,
payload do provedor, bug de transição) → re-adicionar com o **mesmo jobId**
(consumidor idempotente: `ProcessedEvent`/`ON CONFLICT` → `duplicate`, sem
duplo efeito) → confirmar métricas `finance.sync.applied`/`duplicate`,
`finance.projection.computed`. DLQ crescendo = consumidor/API fora ou poison
em massa: pausar produtor, drenar com jobId preservado.

## 5. Concessões `finance.read` (PROJECT.md §3)

- Default deny (inclusive `manager`); `finance.manage` só admin.
- Concessão exige admin + `organization_id` + motivo ≥10 chars, registrada em
  Audit (`finance.read.grant`: ator/org/motivo) + Membership/RoleGrant.
- Stub atual: `FinanceReadGuard` (`x-role: admin|finance|finance.read` ou
  header `x-finance-read: <orgId>` casando; sem → **403**). TODO RBAC real.
- Auditoria sem PII (LGPD.md): `finance.transaction.posted`
  (ator/org/valor/kind/eventId) + `finance.read.grant` (ator/org/motivo).
  Sem nome, e-mail ou documento — a allowlist de `audit-record.ts` descarta o
  resto antes de persistir.
- Frontend oculta `/financeiro` sem `finance.read`; export segue a mesma regra.

## 6. Incidentes comuns

| Sintoma | Causa provável | Ação |
|---|---|---|
| `duplicate` alto no sync | retry do relay/fan-out | esperado (200); checar `applied` correspondente |
| `stale-ignored` em massa | eventos antigos reenfileirados | esperado; checar ordenação do produtor |
| 202 persistente (job nunca `done`) | worker projection fora / Redis fora | checar `finance.projection.compute` + DLQ; próximo GET recomputa inline se carga baixa |
| `finance.dlq` crescendo | API interna fora / poison | §4 |
| Saldo divergente | UPDATE fora de markReceived/markPaid | proibido (regra de ouro); corrigir via baixa estornada, nunca UPDATE direto |
| 403 no `/financeiro` | sem `finance.read` | conceder via admin + motivo (§5) |
