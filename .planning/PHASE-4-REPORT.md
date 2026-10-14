# Fase 4 — Relatório consolidado (orquestrador)

Data: 2026-10-10. Padrão GSD, 5 subagentes especialistas.

## Entregas
- **Billing core:** Customer/Subscription/Invoice/Payment/Refund/WebhookReceipt estendidos, Idempotency-Key, assertTransition 422 sem sobrescrever, confirm exige amount, outbox PaymentConfirmed, 68 testes billing.
- **Asaas:** adapter Sandbox-first, webhook RECEIVED via ON CONFLICT → 200 duplicate + fila apply, VALIDATED→APPLIED, ilegal REJECTED, recon hourly+daily com sintético recon:*, 20 testes.
- **Comms Resend:** EmailMessage event_id UNIQUE + idempotency, 14 templates v1 (deposit/withdrawal/order-filled → OutOfScope), sender upsert + retry 5x + DLQ, webhook bounce, 50 testes.
- **Workers/outbox:** relay SKIP LOCKED jobId=eventId, filas webhook/recon/fanout/DLQ, e2e billing.flow 5 (mock), runbooks + ADR-004.
- **Admin:** cobrancas/assinaturas/auditoria com billing.read/manage, TraceabilityDrawer, BFF proxy Idempotency-Key, 21 rotas build OK.

## Fixes orquestrador (nada perdido)
1. Rota duplicada POST /v1/billing/webhooks/asaas (flow mock vs webhook canônico) → flow movido p/ `asaas-mock` + e2e atualizado; canônico prod = webhook.controller idempotente.
2. AppModule sem BillingWebhook/Reconcile → importados.
3. main.ts sem rawBody → `rawBody:true`.
4. BillingReconcile sem BILLING_POOL → exportado no webhook.module.

## Verificação
- api/workers/admin build PASS
- unit 20 suites 275/275 PASS (Fase 3: 137 preservados)
- e2e 6 suites 35/35 PASS (Fase 3: 30 preservados + 5 billing)

## Aceite
Order→pending→webhook CONFIRMED→outbox→license-hook+email; replay duplicate; ilegal REJECTED; fora-de-ordem não regride; recon sintético. Sem financeiro realizado (Fase 5).

## Próximo
Fase 5 financeiro e relatórios.
