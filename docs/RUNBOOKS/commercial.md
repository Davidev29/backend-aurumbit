# Runbook — Modelo comercial licença × assinatura (Fase 8)

Fonte normativa: `.planning/PHASE-8-PLAN.md`. Sem segredos aqui.

## 1. Matriz (única fonte; código e UI derivam dela)

| billingInterval (plano) | kind (licença) | Vigência | Entitlement origin/priority | Canais típicos |
|---|---|---|---|---|
| `MONTH` | `monthly` | +1M + graça 3d | SUBSCRIPTION/20 | WEB (+BOTH) |
| `YEAR` | `annual` | +12M + graça 3d | SUBSCRIPTION/20 | WEB (+BOTH) |
| `ONE_TIME` | `lifetime` | nunca expira | LICENSE/30 | DESKTOP (+BOTH) |

Regras duras:
- Preço imutável por linha de plano; erro de preço → arquivar + sucessora.
- `lifetime` não renova (409); upgrade mensal/anual → lifetime ok; downgrade =
  revogar + emitir nova (auditoria explícita).
- Canal ausente/legado = `BOTH` (sem gating). `CHANNEL_MISMATCH` ≠ `NOT_FOUND`.
- Offline antigo sem `ch` = BOTH + re-mint no próximo online.

## 2. Fluxo Asaas→licença (pós-pagamento real)

1. Portal cria pedido → BFF valida preço no catálogo → `POST /v1/billing/checkout`
   (invoice PENDING, idempotente por `orderId`). Sessão PENDING — nunca `done`.
2. Cobrança (Asaas) → webhook → `PaymentConfirmed` (outbox `billing.payment.confirmed.v1`).
3. Worker `licensing.issue`: contexto interno → features do plano (catálogo
   público) → `POST /v1/licenses/internal/issue-from-payment` (claim-first por
   eventId; replay → `duplicate`, sem 2ª licença).
4. `LicenseIssued` (kind + featureCodes + channels) → access sync → entitlements
   (origin/prioridade da matriz) → portal polling vira COMPLETED + licenseId.
5. E-mail `license-issued` pelo consumer existente.

## 3. One-way doors (§5 do plano)

- Plano ONE_TIME com preço errado ativado: licenças já emitidas são vitalícias
  (só revogação desfaz). Revisar preço **antes** de `activate`.
- `issueFromPayment` só via PaymentConfirmed real (worker + `x-internal-key`).
- Queda do worker: outbox retém; relay reentrega pelo eventId (sem duplicar).

## 4. Gates operacionais

```bash
# matriz viva (canais por plano):
curl -s http://localhost:3000/v1/products/aurum-base/plans | grep -o '"channel":"[A-Z]*"' | sort | uniq -c
# checkout → paid → licença (sandbox, valor mínimo + estorno):
bash deploy/scripts/smoke-prod.sh  # T6 Fase 7, cobre duplicata sem 2ª cobrança
```
