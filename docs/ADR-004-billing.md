# ADR-004 — Faturamento Sandbox-first, idempotente, sem regressão

- Status: **aceita** (Fase 4)
- Data: 2026-10-10
- Vincula: `PROJECT.md` §§5–6, `docs/RUNBOOKS/billing.md`

## Contexto

Cobrança via Asaas precisa tolerar retries do provedor, entregas fora de ordem
e divergências PG × Asaas sem duplicar licenças/e-mails nem regredir estados
terminais. E-mails transacionais (Resend) têm escopo fechado (14 templates,
`payment-confirmed` entre eles). Vigência da licença inicia na confirmação do
pagamento.

## Decisão

1. **Sandbox-first**: toda integração Asaas nasce contra o Sandbox por adaptador
   (`libs/asaas-adapter`); segredos gerenciados, nunca em código/log. Promoção a
   produção exige runbook + chaves rotacionadas (fora do código).
2. **Idempotência em 4 camadas** (PROJECT.md §5): `Idempotency-Key` nos POSTs;
   `UNIQUE(provider,externalId)` em Payment/Refund/WebhookReceipt
   (`ON CONFLICT DO NOTHING` → 200 duplicate); `UNIQUE(eventId)` em
   ProcessedEvent/Outbox; `jobId = eventId` no BullMQ;
   `idempotencyKey = eventId` no Resend/e-mail stub.
3. **Webhook `RECEIVED → VALIDATED → APPLIED | REJECTED | DUPLICATE`**:
   ilegal → `REJECTED` + alerta (`billing.transition_rejected`), sem
   sobrescrever (núcleo PG: 422; mock: 200+`REJECTED` p/ não gerar retry do
   provedor). `TODO(prod)`: HMAC/allowlist antes de `RECEIVED`.
4. **Fora de ordem não regride**: consumidor checa `version/occurredAt` e o
   estado atual; evento antigo nunca tira `CONFIRMED`/`REFUNDED` do terminal.
   `PaymentConfirmed` exige `paidAt + amount` casando (divergência → `REJECTED`
   + alerta, sem aplicar).
5. **Reconciliação pelo mesmo pipeline**: hourly (pendentes `<7d`) + daily
   03:00 America/Sao_Paulo (`30d`); evento sintético `recon:<id>:<data>`;
   divergência → alerta + e-mail admin + `billing.recon.*`.
6. **Fan-out `PaymentConfirmed → access/licensing/finance/notifications`** com
   stubs `TODO` por alvo (falha isolada por alvo); e-mail via
   `communications.send` (`payment-confirmed` v1). Licença só nasce do pagamento
   confirmado (vigência = confirmação).

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Webhook aplica direto sem receipt/outbox | Retry do provedor duplicaria licença/e-mail; sem trilha `RECEIVED→…` |
| Rejeitar com 4xx/5xx p/ retry do Asaas | Ilegal/duplicate não se resolve com retry; 200 + estado explícito evita tempestade |
| Recon com tabela/endpoint próprios | Dois pipelines = duas semânticas de dedupe; sintético `recon:*` reusa idempotência |
| Produção Asaas desde o dia 1 | Risco de cobrança real em teste; Sandbox-first valida webhook/recon sem dinheiro |

## Consequências

- (+) Replay e fora-de-ordem são no-ops seguros; e2e `billing.flow` trava
  confirmação, duplicate sem duplo efeito, ilegal `REJECTED` e recon sintético.
- (+) Relay único por domínio (`FOR UPDATE SKIP LOCKED 100`, `jobId=eventId`,
  purge 30d só de publicados via TODO job).
- (−) Webhook mock sem HMAC até o `TODO(prod)` — rota pública documentada como
  temporária; produção bloqueada sem assinatura.
- (−) Fan-out com stubs até workers reais por alvo; `TODO`s rastreados no
  runbook §1/§4.
