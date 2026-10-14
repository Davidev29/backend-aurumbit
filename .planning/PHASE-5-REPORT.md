# Fase 5 — Relatório consolidado (orquestrador)

Data: 2026-10-10. Padrão GSD, 5 subagentes especialistas.

## Entregas
- **Finance core:** Category/Account (saldo só via Transaction), Receivable PREVISTO/PENDENTE/RECEBIDO/CANCELADO/INADIMPLENTE, Payable PREVISTO/PENDENTE/PAGO/CANCELADO, Transaction único mutador + idempotency, Snapshot persistência, overview com inadimplência, mark-received/paid idempotentes, finance.read escopado + manage só admin.
- **Projeções:** premisesHash sha256, previsto/pendente/realizado + líquido por mês/conta/categoria, expansão 12m, shift boleto D+2, hit 200 / miss leve 200 / miss pesado 202 + polling, recompute manage, invalidação em TransactionPosted.
- **Sync billing→finance:** PaymentConfirmed→RECEBIDO+INCOME, Failed→INADIMPLENTE se vencido, Refund→PAGO+EXPENSE (parcial/total), Subscription→invalida snapshot, ProcessedEvent mesma txn, fora-de-ordem não regride, outbox TransactionPosted/Overdue/Recomputed.
- **Admin:** financeiro real (pagar/receber/transações/projeções), KPIs previsto/pendente/realizado + inadimplência, ProjectionChart Recharts + TZ + tabela a11y, SettleDialog motivo≥10, Export CSV stub, Traceability 5 passos, 29 páginas build OK.
- **Workers/docs:** finance.sync + projection.compute jobId=eventId/scope:ref:hash + DLQ, e2e finance.flow 7, RUNBOOK + ADR-005.

## Conflitos reconciliados pelos especialistas (nada perdido)
Schema união (superset sem duplicatas), guard finance-read união (header/query/body), queues finance fundido, flow PG vs flow in-memory não wireado junto (sem sombra de rotas).

## Verificação orquestrador
- api/workers/admin build PASS
- unit 24 suites 326/326 PASS (Fase 4: 275 preservados)
- e2e 7 suites 42/42 PASS (Fase 4: 35 preservados + 7 finance)

## Aceite
PaymentConfirmed→RECEBIDO+INCOME+saldo; replay sem duplicar; baixas manuais idempotentes; projeções hit/miss/202; 403 sem finance.read; grants auditados sem PII.

## Próximo
Fase 6 robustez e escala.
