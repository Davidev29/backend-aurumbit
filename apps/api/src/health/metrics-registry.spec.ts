import {
  auditEventsTotal,
  billingReconTotal,
  billingWebhookTotal,
  bullmqDlqDepth,
  emailSendTotal,
  financeProjectionTotal,
  httpRequestDuration,
  httpRequestsTotal,
  metricsExposition,
  observeHttpRequest,
  resetMetricsForTests,
  retentionPurgedTotal,
  retentionRunsTotal,
  seedPhase6Series,
  setDlqDepth,
  setOutboxLag,
  outboxLagSeconds,
} from './metrics-registry';

const REQUIRED = [
  'http_requests_total',
  'http_request_duration_seconds',
  'outbox_lag_seconds',
  'bullmq_dlq_depth',
  'billing_recon_total',
  'billing_webhook_total',
  'finance_projection_total',
  'retention_runs_total',
  'retention_purged_total',
  'email_send_total',
  'audit_events_total',
  'app_build_info',
];

describe('metrics-registry (Fase 6)', () => {
  beforeEach(() => resetMetricsForTests());

  it('expõe HELP/TYPE de todas as séries Fase 6 mesmo sem tráfego', () => {
    const body = metricsExposition();
    for (const name of REQUIRED) expect(body).toContain(name);
  });

  it('contadores aparecem com amostras após incremento', () => {
    observeHttpRequest('GET', '/v1/access/check', 200, 0.012);
    billingReconTotal.inc({ result: 'checked' });
    billingWebhookTotal.inc({ result: 'applied' });
    financeProjectionTotal.inc({ result: 'computed' });
    retentionRunsTotal.inc({ job: 'outbox-purge', result: 'ok' });
    retentionPurgedTotal.inc({ job: 'outbox-purge' }, 7);
    emailSendTotal.inc({ template: 'payment-confirmed', result: 'sent' });
    auditEventsTotal.inc({ action: 'license.issue' });
    setOutboxLag('billing.payment.confirmed.v1', 3.5);
    setDlqDepth('billing.dlq', 0);
    seedPhase6Series(['comm.dlq'], ['communications.email.requested.v1']);

    const body = metricsExposition();
    expect(body).toMatch(/http_requests_total\{[^}]*method="GET"[^}]*\} 1/);
    expect(body).toContain('http_request_duration_seconds_bucket');
    expect(body).toContain('billing_recon_total{result="checked"} 1');
    expect(body).toContain('billing_webhook_total{result="applied"} 1');
    expect(body).toContain('finance_projection_total{result="computed"} 1');
    expect(body).toContain('retention_runs_total{job="outbox-purge",result="ok"} 1');
    expect(body).toContain('retention_purged_total{job="outbox-purge"} 7');
    expect(body).toContain('email_send_total{result="sent",template="payment-confirmed"} 1');
    expect(body).toContain('audit_events_total{action="license.issue"} 1');
    expect(body).toContain('outbox_lag_seconds{topic="billing.payment.confirmed.v1"} 3.5');
    expect(body).toContain('bullmq_dlq_depth{queue="billing.dlq"} 0');
    expect(body).toContain('bullmq_dlq_depth{queue="comm.dlq"} 0');
  });

  it('histograma expõe buckets/sum/count', () => {
    observeHttpRequest('POST', '/webhooks/asaas', 200, 0.4);
    const body = metricsExposition();
    expect(body).toContain('http_request_duration_seconds_bucket{');
    expect(body).toContain('http_request_duration_seconds_sum{');
    expect(body).toContain('http_request_duration_seconds_count{');
    expect(httpRequestDuration).toBeDefined();
    expect(httpRequestsTotal).toBeDefined();
    expect(outboxLagSeconds).toBeDefined();
  });
});
