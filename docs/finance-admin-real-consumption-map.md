# Mapeamento — Consumo real do financeiro no admin

Documento gerado por fluxo agentico (5 subagentes de mapeamento). Objetivo: sair do modo mock/stub e consumir a base real do módulo financeiro no admin, mantendo os fluxos funcionais (cadastro de despesas/receitas, listagens, baixas, resumo) mesmo com Asaas indisponível.

## 1. Superfície admin (UI)

Arquivo principal: `apps/admin/app/(app)/financeiro/page.tsx`

Tabs:
- `pagar` → `PayableTable`
- `receber` → `ReceivableTable`
- `transacoes` → `TransactionTable`
- `projecoes` → `ProjectionChart`

KPIs (`FinanceSummary`): previsto, pendente, realizado, inadimplente, taxaInadimplencia, isStale/staleReason/asOf.

Mutations:
- `createExpense` (Nova despesa)
- `createReceivableAuto` (Receita automática)
- `settlePayable` / `settleReceivable` (baixa)
- `exportFinanceCsv`

Permissões:
- `finance.read` para leitura (default deny para manager)
- `finance.manage` para criar/baixar/exportar

Org: `useOrgStore` (localStorage `aurum-org`), fallback `me.organizationId`.

## 2. BFF financeiro (`apps/admin/app/api/finance/*`)

Problemas identificados:
- Gate por `API_FINANCE_URL` (domínio), não `API_INTERNAL_URL`; quando ausente retorna mock silencioso (sem 502 fail-closed).
- Apenas `expenses`, `receivables/auto`, `notifications*` encaminham `x-org-id`; demais não.
- Nenhuma rota encaminha `x-role: admin` (necessário para `AdminStubGuard` e leitura implícita).
- Nenhuma rota possui try/catch → falha de rede não normaliza para 502.
- Sem mapeamento de campos (cents→reais, status, paginação).
- Endpoints ausentes no backend: `facets`, `trace`, `summary`, `export`, `projection` (singular), `settle`.

## 3. Backend core (`/v1/finance`)

Controller: `apps/api/src/modules/finance/finance.controller.ts`
Service: `apps/api/src/modules/finance/finance.service.ts`

Endpoints reais:
- `GET overview` (cents, buckets, accounts, totalBalance, delinquencyRate)
- `GET/POST categories`, `GET/POST accounts`
- `GET/POST receivables`, `POST receivables/:id/mark-received`
- `GET/POST payables`, `POST payables/:id/mark-paid`
- `GET transactions`

Características:
- Valores em cents; listas são arrays (sem paginação real, apenas limit).
- Org scoping por `x-org-id` ou query/body.
- Guards: `FinanceReadGuard` (read) + `AdminStubGuard` (write).
- Idempotência obrigatória nas baixas (`Idempotency-Key` ≥ 8 chars).
- Transições validadas (`assertTransition`); ilegal → 422.
- `balanceCents` muta apenas em markReceived/markPaid (regra de ouro).

## 4. Backend automação (`/v1/finance/expenses`, `/receivables/auto`, `/notifications`)

Controller: `finance-automation.controller.ts`
Service: `finance-automation.service.ts`

- `POST /expenses` → cria payable `SUPPLIER` + job `BILL_PAY`; Asaas opcional (47/48 dígitos); fallback manual/cancelado.
- `GET /expenses/:id/automation` → job ou null.
- `POST /receivables/auto` → cria receivable `MANUAL` + cobrança Asaas (`AUTO_CHARGE`).
- `GET /notifications`, `POST /notifications/:id/read`.

Idempotência por `Idempotency-Key` + UNIQUE job + dedupe por source.

Asaas: sandbox por padrão; falhas retryable enfileiram follow-up; não-retryable viram `UnprocessableEntityException`.

## 5. Projeções, resumo, trace, facets

- Backend projections: `/v1/finance/projections` (plural) retorna `ProjectionSnapshot` (realized/pending/forecast cents), não buckets receita×despesa.
- Admin espera buckets por período (week/month/year) + category/product.
- `trace`, `facets`, `summary`, `export`, `settle` não existem no backend.
- `summary` admin deve ser adaptado de `overview` (cents→reais, status mapping).

## 6. Testes

- API: 7 suites, 81 testes passando (finance service, transitions, automation, projections, sync, barcode).
- E2E finance: 7 testes passando.
- Nenhum teste de BFF finance.

## 7. Plano de implementação (fases)

### Fase A — Habilitar consumo real (mínimo viável)
1. Definir `API_FINANCE_URL` no admin `.env.local` (ou migrar para `API_INTERNAL_URL`).
2. Padronizar BFF finance para:
   - encaminhar `Cookie`, `Authorization` (via `upstreamAuthHeaders`), `x-role: admin`, `x-org-id`;
   - try/catch com 502 fail-closed;
   - mapear cents→reais e shapes.
3. Adaptar `summary` de `overview`.
4. Adaptar listagens (`payables`, `receivables`, `transactions`) de arrays para `Page`.

### Fase B — Cadastros e baixas funcionais
1. Ajustar `createExpense`/`createReceivableAuto` para mapear payable/receivable reais para views.
2. Implementar baixa real:
   - UI deve selecionar conta (`accountId`) — atualmente só motivo/confirmação.
   - BFF `settle` → backend `mark-paid`/`mark-received`.
   - Mapear resposta `{transactionId, auditId, status}`.
3. Notificações reais já proxeadas; garantir `x-org-id`.

### Fase C — Projeções, trace, facets, export
1. Decidir: adaptar UI ao `ProjectionSnapshot` ou criar endpoint de buckets.
2. Criar endpoints backend para `facets` (categorias/produtos) e `trace` (agregação por correlationId).
3. Implementar export CSV no backend com auditoria.

### Fase D — Testes
1. Testes de BFF finance (proxy + mapping + 502).
2. Testes de integração admin↔backend com DB real.
3. E2E dos fluxos de cadastro/baixa.

## 8. Critérios de aceite
- Admin finance não usa mock quando backend disponível.
- Cadastro de despesa/receita persiste e aparece nas listagens.
- Baixa cria Transaction e atualiza saldo.
- Resumo reflete overview real.
- Falha de backend retorna 502 visível (sem fallback silencioso).
- Asaas indisponível não quebra cadastro manual (fallback preservado).
