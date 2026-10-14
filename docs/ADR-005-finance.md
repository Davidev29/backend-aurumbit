# ADR-005 — Financeiro: previsto/pendente/realizado, Transaction único mutador, projeções com premisesHash

- Status: **aceita** (Fase 5)
- Data: 2026-10-10
- Vincula: `PROJECT.md` §§3/5, `REQUIREMENTS.md` §3, `docs/RUNBOOKS/finance.md`, `docs/LGPD.md`

## Contexto

O financeiro precisa distinguir o esperado (previsto/pendente) do realizado,
tolerar retries e eventos fora de ordem do pipeline billing sem duplicar
lançamentos nem regredir baixas, e responder projeções que podem ser caras
sem bloquear leitura. Leitura financeira é concessão explícita escopada
(PROJECT.md §3, default deny), e auditoria não pode carregar PII (LGPD.md).

## Decisão

1. **Previsto/pendente/realizado**: Receivables/Payables nascem
   `PREVISTO`/`PENDENTE` (com `INADIMPLENTE` quando vencido sem pagamento);
   viram `RECEBIDO`/`PAGO` só via baixa (sync do `PaymentConfirmed` ou manual
   `mark-received`/`mark-paid`). `CANCELADO` sai dos buckets (soma separada).
2. **Transaction único mutador de saldo** (regra de ouro): só
   `markReceived`/`markPaid` contêm `UPDATE` em
   `financial_accounts.balanceCents`, sempre via FinancialTransaction na mesma
   transação (+ outbox). Nenhum outro método toca saldo. Baixas idempotentes:
   replay (mesma `Idempotency-Key` ou título já baixado) retorna o existente.
3. **Sync idempotente em duas camadas** (PROJECT.md §5):
   `finance_processed_events(eventId)` (`ON CONFLICT DO NOTHING` → replay =
   `duplicate`) + `UNIQUE(eventId)` / `UNIQUE(provider, externalId)` nos
   lançamentos. Fora de ordem nunca regride `RECEBIDO`/`PAGO`
   (`shouldApplyFinanceEvent`: versão/occurredAt + gate de terminal).
4. **Projeções com `premisesHash`**: snapshot endereçado por
   `(scope, refDate, premisesHash)` (`premisesHash = SHA256` das premissas);
   hit → 200; miss leve → 200 inline; miss pesado → 202 + `jobId =
   scope:ref:hash` com polling em `GET jobs/:jobId`. Worker
   `finance.projection.compute` (`jobId` preservado, retry exp 5x + DLQ
   `finance.dlq`) aplica via endpoint interno idempotente. Invalidação
   primária por evento (`FinanceTransactionPosted`, `Subscription*`); ticker
   periódico como safety net.
5. **`finance.read` explícito escopado** (PROJECT.md §3): default deny;
   concessão = admin + org + motivo, auditada (`finance.read.grant`:
   ator/org/motivo). Auditoria de lançamentos (`finance.transaction.posted`:
   ator/org/valor/kind/eventId) sem PII — allowlist em `audit-record.ts`.
6. **Um banco por domínio, sem FK cross-DB**: referências billing↔finance são
   opacas (`externalId`, `sourceId`); o flip do Payment no reembolso é TODO do
   billing core (o finance só classifica `refundClassification` no outbox).

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Saldo em coluna atualizada por vários caminhos | Divergência silenciosa; regra de ouro torna a mutação auditável num ponto só |
| Projeção sempre síncrona | Cômputo pesado bloquearia leitura; 202 + jobId preserva UX com polling |
| Snapshot só por (scope, ref) sem hash | Mudança de premissa reutilizaria snapshot velho; hash isola cada premissa |
| Replay com 409 | Dedupe é o caminho esperado (PROJECT.md §5); 200 + `duplicate` evita retry inútil |
| Auditoria com payload cheio | PII em trilha de 5 anos (LGPD.md); allowlist mínima ator/org/motivo/valores |

## Consequências

- (+) Replay e fora-de-ordem são no-ops seguros; e2e `finance.flow` trava
  confirmação → recebido+saldo, duplicate sem duplo efeito, baixas manuais
  idempotentes, projeções hit/miss + 202, 403 sem `finance.read`.
- (+) Workers `finance.sync` + `finance.projection.compute` com `jobId`
  estável, retry exp + DLQ `finance.dlq`, métricas `finance.*`, ticker de
  invalidação; filas `billing.*` intactas (sem duplicação).
- (−) Fluxo hermético (`finance-flow.*`, in-memory p/ e2e) duplica em
  miniatura o contrato do núcleo PG — divergência futura exige alinhar os
  dois (o e2e trava o contrato canônico).
- (−) `FinanceReadGuard` ainda é stub (`x-role`/`x-finance-read`); RBAC real
  (Membership/RoleGrant) é TODO com o dono do auth.
