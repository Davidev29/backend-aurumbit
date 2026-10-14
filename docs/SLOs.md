# SLOs — Aurum Bit (Fase 6)

Alvos de nível de serviço + catálogo de métricas. Runbooks: `docs/RUNBOOKS/health.md`
(probes), `docs/RUNBOOKS/correlation.md` (correlação ponta-a-ponta).

## 1. SLOs

| Serviço | SLO | Janela | Fonte |
|---|---|---|---|
| API disponibilidade (`/health/ready` 200) | ≥ 99,5% | 30d | Prometheus `up` + probe |
| `check-access` p99 | < 50 ms (local; staging c/ PG/Redis < 150 ms) | por deploy + contínuo | `http_request_duration_seconds` |
| Webhook Asaas ack (recepção → 200) | < 2 s, 99% | 7d | `http_request_duration_seconds{route="/v1/billing/webhooks"}` + `billing_webhook_total` |
| Reconciliação hourly/daily | 100% execuções/dia; divergência → alerta | 24h | `billing_recon_total` |
| E-mail transacional (Resend) | ≥ 99% `sent/(sent+dlq)` por template | 7d | `email_send_total` |
| Outbox lag por tópico | < 5 min (p99) | 1h | `outbox_lag_seconds` |
| DLQ depth (todas as filas) | 0 (qualquer `> 0` por 5 min → page) | contínuo | `bullmq_dlq_depth` |
| Auditoria append | 100% emits persistidos (sem `update/delete`) | 30d | `audit_events_total` |

Carga de referência: `node deploy/load/smoke.js --base <url> --n 100`
(check-access autenticado exige `SMOKE_TOKEN`; webhook exige `SMOKE_ASAAS_SECRET` —
sem eles os checks viram `SKIP`, nunca `FAIL`).

## 2. Catálogo de métricas (`GET /metrics`, Prometheus exposition)

Lógico (PROJECT §5) → Prometheus (`*` = label):

| Lógico | Prometheus |
|---|---|
| `http.requests` | `http_requests_total{method,route,status}`, `http_request_duration_seconds{*}` (histograma) |
| `outbox.lag` | `outbox_lag_seconds{topic}` (gauge; `0` = drenada) |
| `bullmq.dlq.depth` | `bullmq_dlq_depth{queue}` (gauge) |
| `billing.recon.*` | `billing_recon_total{result=checked\|diverged\|completed}` |
| `billing.webhook.*` | `billing_webhook_total{result=received\|applied\|duplicate\|rejected}` |
| `finance.projection.*` | `finance_projection_total{result=hit\|miss\|computed\|failed\|invalidated\|…}` |
| `retention.*` | `retention_runs_total{job,result}`, `retention_purged_total{job}` |
| `email.send.*` | `email_send_total{template,result=sent\|duplicate\|dlq}` |
| `audit.events` | `audit_events_total{action}` |

Fonte dos nomes: `libs/observability/src/metrics.ts`. Exposition HTTP:
`apps/api/src/health/metrics-registry.ts` (autocontido, mesmos nomes; convergirá
para o lib via workspace quando a API dependê-lo). Contadores in-memory por
domínio (`/v1/billing/metrics`, `/v1/finance/metrics`) continuam como fonte
hermética p/ e2e; produção espelha no Prometheus via helpers `inc*`/`set*`.

## 3. Tracing

`initTracing()` (`libs/observability`): no-op com `warn` quando
`OTEL_EXPORTER_OTLP_ENDPOINT` está ausente (nada quebra); com endpoint, o wiring
real (NodeSDK + OTLP exporter) pluga no mesmo ponto sem mudar chamadores de
`withSpan`. Correlação de negócio (`x-correlation-id`) é independente do OTel e
propaga Outbox→BullMQ→Resend→Audit — ver `docs/RUNBOOKS/correlation.md`.

## 4. Queues (`/admin/queues`, admin-only)

Stub Fase 6 preservando **path + auth** (`x-role: admin` ou service token).
Sem `@bull-board/*` de propósito (dep pesada adiada). Wiring futuro: montar o
`ExpressAdapter` do Bull Board neste path atrás do mesmo guard + alimentar
`bullmq_dlq_depth` via `setDlqDepth()` no tick do relay.

## 5. Alertas

Regras stub em `deploy/obs/alerts.yaml` (`BullMQDlqNonEmpty` → page,
`OutboxLagHigh`/`BillingReconDiverged` → ticket).
TODO: receiver Slack + PagerDuty no Alertmanager (sem receiver, as regras só avaliam).

## 6. Dashboards

Stubs importáveis em `deploy/obs/`: `runtime.json` (HTTP/outbox/DLQ/recon),
`email.json` (envios/DLQ comm), `audit.json` (auditoria/projeções/retenção).
