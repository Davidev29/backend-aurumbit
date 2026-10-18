# PHASE-11-PLAN.md — Consumo real do financeiro no admin (tracer-first, GSD)

> Fonte normativa: `docs/finance-admin-real-consumption-map.md` (mapeamento agentico).
> Objetivo: remover o mock silencioso do módulo financeiro do admin e consumir a base real (Postgres finance), mantendo cadastro de despesas/receitas, listagens, baixas, resumo e notificações funcionais, mesmo com Asaas indisponível.

## Princípio de decomposição (tracer-first)

Cada etapa entrega um fluxo ponta-a-ponta verificável (UI → BFF → Nest → PG → resposta mapeada) antes de expandir. Nenhuma etapa pode ser considerada concluída sem evidência de teste.

## Etapas

### E0 — Baseline e contrato de dados (docs + tipos)
- Escopo: documentar shapes backend vs admin, definir mapeadores (cents→reais, status, paginação).
- Arquivos: `docs/finance-admin-real-consumption-map.md`, `apps/admin/lib/finance.ts`, `apps/admin/lib/types.ts`.
- Aceite: matriz de mapeamento (backend → admin) aprovada; nenhum código de produção alterado.

### E1 — Tracer 1: Resumo real (KPIs)
- Escopo: BFF `/api/finance/summary` consome `/v1/finance/overview` e mapeia para `FinanceSummary`.
- Arquivos: `apps/admin/app/api/finance/summary/route.ts`, `apps/admin/lib/finance.ts`.
- Mapeamento: previsto/pendente/realizado/inadimplente = (receivables+payables cents)/100; taxaInadimplencia = delinquencyRate; isStale/staleReason/asOf derivados (snapshot sem hash → stale true).
- Aceite: KPIs da página refletem overview real; teste unitário do mapeador.

### E2 — Tracer 2: Listagem de contas a pagar (real)
- Escopo: BFF `/api/finance/payables` consome `/v1/finance/payables`, mapeia array → `Page<PayableView>`.
- Arquivos: `apps/admin/app/api/finance/payables/route.ts`.
- Mapeamento: amountCents→amount (reais), dueDate, status, paidAt, supplier (sourceId/expense), category (categoryId lookup ou code), recurrence default MENSAL.
- Aceite: tabela exibe dados reais; paginação por cursor (limit) funcional.

### E3 — Tracer 3: Listagem de contas a receber (real)
- Escopo: BFF `/api/finance/receivables` consome `/v1/finance/receivables`, mapeia → `Page<ReceivableView>`.
- Arquivos: `apps/admin/app/api/finance/receivables/route.ts`.
- Aceite: tabela exibe dados reais.

### E4 — Tracer 4: Extrato de transações (real)
- Escopo: BFF `/api/finance/transactions` consome `/v1/finance/transactions`, mapeia kind INCOME/EXPENSE → RECEITA/DESPESA, occurredAt→settledAt, amountCents→amount.
- Arquivos: `apps/admin/app/api/finance/transactions/route.ts`.
- Aceite: extrato exibe lançamentos reais.

### E5 — Tracer 5: Cadastro de despesa (real)
- Escopo: BFF `/api/finance/expenses` consome `/v1/finance/expenses`, mapeia payable real para `CreateExpenseResult`.
- Arquivos: `apps/admin/app/api/finance/expenses/route.ts`, `apps/admin/components/finance/ExpenseDialog.tsx`.
- Aceite: despesa persiste e aparece na listagem; Asaas indisponível não quebra (fallback manual).

### E6 — Tracer 6: Cadastro de receita automática (real)
- Escopo: BFF `/api/finance/receivables/auto` consome `/v1/finance/receivables/auto`.
- Arquivos: `apps/admin/app/api/finance/receivables/auto/route.ts`, `ReceivableAutoDialog.tsx`.
- Aceite: recebível persiste e aparece na listagem; falha Asaas preserva título.

### E7 — Baixa de payable/receivable (real)
- Escopo: UI seleciona conta (accountId); BFF `settle` → backend `mark-paid`/`mark-received`; mapeia resposta.
- Arquivos: `SettleDialog.tsx`, `apps/admin/app/api/finance/payables/[id]/settle/route.ts`, `receivables/[id]/settle/route.ts`.
- Aceite: baixa cria Transaction, atualiza saldo, idempotente (replay retorna existente).

### E8 — Padronização BFF (headers + fail-closed)
- Escopo: todas as rotas finance BFF passam a usar `upstreamAuthHeaders`, encaminhar `x-org-id`, try/catch 502.
- Arquivos: todas `apps/admin/app/api/finance/*/route.ts`.
- Aceite: sem backend → 502 visível; com backend → dados reais.

### E9 — Notificações (real)
- Escopo: já proxeadas; garantir headers e mapeamento.
- Aceite: sino exibe notificações reais.

### E10 — Projeções (decisão + adaptação)
- Escopo: decidir entre adaptar UI ao `ProjectionSnapshot` ou criar endpoint de buckets.
- Arquivos: `ProjectionChart.tsx`, `apps/admin/app/api/finance/projection/route.ts`, backend projections.
- Aceite: projeção funcional com dados reais (mesmo que simplificada).

### E11 — Trace, facets, export
- Escopo: criar endpoints backend para facets/trace/export ou remover do UI.
- Arquivos: novos controllers/services + BFF.
- Aceite: funcionalidades não quebram (ou são removidas com justificativa).

### E12 — Testes
- Escopo: testes unitários de mapeadores BFF, integração admin↔backend, E2E fluxos.
- Comandos:
  - `npm --prefix apps/api run test -- finance admin`
  - `npm --prefix apps/api run test:e2e -- finance`
- Aceite: todos passando + evidência de 502 fail-closed.

## Gates transversais

- Nenhum mock silencioso em prod-path (A-MOCK-001).
- `x-role: admin` e `x-org-id` em todas as rotas finance BFF.
- Idempotência preservada (replay não duplica).
- Asaas indisponível não quebra cadastro manual.
- Saldo muta apenas via mark-paid/mark-received.

## Ordem de execução (tracer-first)

E0 → E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8 → E9 → E10 → E11 → E12

Cada etapa deve ser validada antes de avançar (stop_on_failure: true).
