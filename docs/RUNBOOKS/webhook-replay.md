# Runbook — Re-entrega (replay) de webhook Asaas (Fase 7 T6)

Fonte normativa: `PROJECT.md` §5, `docs/RUNBOOKS/billing.md` §§2–3, Guards em
`apps/api/src/modules/billing/webhook.transitions.ts` +
`webhook.service.ts` (`RECEIPT_INSERT`).

## 1. Por que é seguro re-entregar

- Dedupe físico: `INSERT ... ON CONFLICT (provider, "externalId") DO NOTHING`
  (`externalId = <EVENT>:<paymentId>`, `eventId = wh:asaas:<externalId>`).
- Redelivery do mesmo fato → HTTP **200** com `{ duplicate: true }` — sem
  re-enfileirar, sem reemitir outbox, sem duplicar licença/e-mail.
- Máquina de receipts: `RECEIVED → VALIDATED → APPLIED | REJECTED | DUPLICATE`;
  terminal nunca regride (`isWebhookTerminal`).
- Replay com `Idempotency-Key` no billing core segue a mesma regra
  (`registerPayment`/`createInvoice` retornam o existente).

## 2. Como re-entregar com segurança

1. **Via painel Asaas** (preferido): cobrança → Webhooks/Entregas → Reenviar.
   O Asaas repete o mesmo `event` + `payment.id` → cai no `DUPLICATE` sozinho.
2. **Via curl** (mesmo efeito, sem PII no log — só `event`/`paymentId`):
   ```bash
   curl -sS -X POST https://api.aurumbit.com/v1/billing/webhooks/asaas \
     -H 'Content-Type: application/json' \
     -H "asaas-access-token: $ASAAS_WEBHOOK_SECRET" \
     -d '{"event":"PAYMENT_CONFIRMED","payment":{"id":"pay_123"}}'
   # 1ª entrega: {"received":true,"duplicate":false,"eventId":"wh:asaas:PAYMENT_CONFIRMED:pay_123"}
   # 2ª entrega (igual): {"received":true,"duplicate":true,"eventId":"wh:asaas:PAYMENT_CONFIRMED:pay_123"}
   ```
3. **Automatizado**: `deploy/scripts/smoke-prod.sh` (precisa de
   `SMOKE_ASAAS_SECRET`) faz 1ª+2ª entrega com `pay_smoke_<epoch>` e valida §3.
4. **Nunca**: recriar a cobrança no Asaas "para testar" (isso é fato novo, não
   duplicata); UPDATE direto em `webhook_receipts`/`payments` (usar
   `confirmPayment`/refund pela API).

## 3. Asserts de DUPLICATE (pós re-entrega)

| # | Assert | Esperado |
|---|--------|----------|
| 1 | Ambas as entregas | HTTP 200 (inclusive `DUPLICATE`/`REJECTED` — evita retry inútil) |
| 2 | `eventId` | idêntico nas duas (`wh:asaas:<EVENT>:<paymentId>`) |
| 3 | `duplicate` | `false` na 1ª, `true` na 2ª (re-execução do script: `true`/`true` = ok) |
| 4 | Sem 2ª cobrança/licença | contagem de invoices estável; 1 licença por `externalId` |
| 5 | Métricas | `billing.webhook.duplicate` +1, `applied` inalterado (`GET /v1/billing/metrics`, admin) |

## 4. Reconciliação (rede de segurança do replay)

- **Hourly** (`0 * * * *`): pendentes `<7d`. **Daily 03:00 America/Sao_Paulo**:
  janela `30d` (`reconcile.transitions.ts`, `reconcile.cron.ts`).
- Exige `RECONCILE_CRON_ENABLED=1` em **uma** réplica (ou ticker dos workers).
- Evento sintético `recon:<id>:<data>` passa pelo mesmo pipeline
  (`POST /v1/billing/webhooks/recon-apply`, interno `x-internal-key`).
- Valor/estado divergente → alerta + e-mail admin + `billing.recon.diverged`;
  corrigir via `confirmPayment`/refund, nunca UPDATE direto.

## 5. Quando alertar (virar incidente)

- `REJECTED` em massa: mudança de payload/evento novo do Asaas → mapear em
  `paymentTargetForAsaasEvent`, replay manual após o fix.
- `DUPLICATE` **sem `APPLIED` correspondente**: receipt travado em
  `RECEIVED`/`VALIDATED` (worker/apply fora) → checar fila `billing.webhook.apply`
  + `POST /v1/billing/webhooks/apply` (interno); reconciliação cobre o gap.
- `billing.dlq` crescendo ou `billing.recon.diverged` > 0 por >1h: pausar
  produtor, drenar com `jobId = eventId` preservado (`billing.md` §5).
- Webhook retornando `5xx` ou `401` em massa: segredo/gateway quebrado — entrega
  do Asaas para de ser acked; tratar como P1 (perda de confirmação de pagamento).
