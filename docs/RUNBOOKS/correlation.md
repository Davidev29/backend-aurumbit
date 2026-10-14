# Runbook — correlação `x-correlation-id` ponta-a-ponta (Fase 6)

Contrato (REQUIREMENTS §4, PROJECT §5): `eventId` = idempotência
(`UNIQUE(eventId)`, `jobId=eventId`, `Idempotency-Key=eventId`);
`correlationId` = SÓ correlação (nunca dedupe por ele; ausente → gera).

## Fluxo verificado (e-mail transacional)

```
HTTP (x-correlation-id)
  → 1. Outbox/persistência : EmailService.requestEmail persiste `correlationId`
       (apps/api/src/modules/communications/email.service.ts)
  → 2. BullMQ              : toSendJob inclui `correlationId`; jobId = eventId
       (apps/api/src/modules/communications/email-consumer.ts);
       relay genérico preserva quando a linha carrega (common/outbox/outbox-relay.ts#envelopeOf)
  → 3. Resend              : Idempotency-Key = eventId (sempre);
       correlationId viaja como tag [{name:'correlationId',value}]
       (email-sender.worker.ts → ResendClient(tags) em libs/resend-adapter)
  → 4. Audit               : metadata.correlationId permitido na allowlist
       (apps/api/src/modules/audit/audit-record.ts)
```

Helpers puros em `libs/observability/src/correlation.ts`
(`propagateCorrelation`, `toBullMqJob`, `resendIdempotencyKeyOf`,
`resendTagsWithCorrelation`, `auditMetadataWithCorrelation`).

## Verificação

- Unit: `apps/api/src/health/correlation-flow.spec.ts` (5 casos: envelope, tags,
  allowlist, eco no `/metrics` com/sem header).
- `curl`:
  ```bash
  curl -s -D - http://localhost:3000/metrics -H 'x-correlation-id: demo-123' -o /dev/null | grep -i x-correlation-id
  # x-correlation-id: demo-123
  ```

## Suporte

Sempre pedir o `x-correlation-id` (ecoado em TODAS as respostas, inclusive
`/metrics` e erros) + horário + payload do `/ready`.
