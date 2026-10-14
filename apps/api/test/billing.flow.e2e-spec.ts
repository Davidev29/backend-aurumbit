import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AdminStubGuard } from '../src/modules/access/admin.guard';
import { BillingFlowController } from '../src/modules/billing/billing-flow.controller';
import { BillingFlowService } from '../src/modules/billing/billing-flow.service';

// Fluxo canônico de faturamento (e2e hermético, sem PG/Redis):
// Order → Invoice pending → webhook CONFIRMED (mock Asaas) → PaymentConfirmed
// outbox → License hook TODO → Email stub; replay = duplicate sem duplicar;
// transição ilegal = REJECTED. Guarda stub `x-role: admin` (webhook é público,
// como o Asaas real — sem stub).
describe('Billing flow (e2e)', () => {
  let app: INestApplication;
  let flow: BillingFlowService;
  const admin = { 'x-role': 'admin' };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BillingFlowController],
      providers: [BillingFlowService, AdminStubGuard],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    flow = moduleFixture.get(BillingFlowService);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  function asaasConfirmed(externalId: string, value: number) {
    return {
      event: 'PAYMENT_CONFIRMED',
      payment: { id: externalId, value, confirmedDate: '2026-10-10T12:00:00.000Z' },
    };
  }

  it('Order → Invoice pending (webhook ainda não aplicado)', async () => {
    const order = await request(app.getHttpServer())
      .post('/v1/billing/orders')
      .set(admin)
      .send({ customer_id: 'cust-1', product_id: 'prod-1', amount_cents: 7900 })
      .expect(201);
    expect(order.body.order.status).toBe('PENDING');
    expect(order.body.invoice.status).toBe('PENDING');
    expect(order.body.payment.status).toBe('PENDING');
    expect(order.body.payment.externalId).toMatch(/^pay_/);

    const invoice = await request(app.getHttpServer())
      .post(`/v1/billing/orders/${order.body.order.id}/invoices`)
      .set(admin)
      .expect(201);
    expect(invoice.body.status).toBe('PENDING');
    expect(invoice.body.id).toBe(order.body.invoice.id); // idempotente
  });

  it('webhook CONFIRMED (mock Asaas) → PaymentConfirmed outbox + license hook + email stub', async () => {
    const order = await request(app.getHttpServer())
      .post('/v1/billing/orders')
      .set(admin)
      .send({ customer_id: 'cust-2', product_id: 'prod-1', amount_cents: 7900 })
      .expect(201);
    const externalId = order.body.payment.externalId as string;

    const wh = await request(app.getHttpServer())
      .post('/v1/billing/webhooks/asaas-mock')
      .send(asaasConfirmed(externalId, 79.0))
      .expect(200);
    expect(wh.body.status).toBe('APPLIED');

    const got = await request(app.getHttpServer())
      .get(`/v1/billing/orders/${order.body.order.id}`)
      .set(admin)
      .expect(200);
    expect(got.body.order.status).toBe('PAID');
    expect(got.body.invoice.status).toBe('PAID');
    expect(got.body.payment.status).toBe('CONFIRMED');
    expect(got.body.payment.paidAt).toBe('2026-10-10T12:00:00.000Z');

    const outbox = await request(app.getHttpServer()).get('/v1/billing/outbox').set(admin).expect(200);
    const confirmed = outbox.body.filter((e: { type: string }) => e.type === 'billing.payment.confirmed.v1');
    expect(confirmed.length).toBeGreaterThan(0);
    const evt = confirmed.find((e: { payload: { externalId: string } }) => e.payload.externalId === externalId);
    expect(evt.eventId).toBe(`billing-payment-confirmed:${externalId}`);

    const hooks = await request(app.getHttpServer()).get('/v1/billing/license-hooks').set(admin).expect(200);
    const hook = hooks.body.find((h: { eventId: string }) => h.eventId === evt.eventId);
    expect(hook).toBeDefined();
    expect(hook.action).toMatch(/TODO\(worker licensing\)/);

    const emails = await request(app.getHttpServer()).get('/v1/billing/emails').set(admin).expect(200);
    const mail = emails.body.find((m: { idempotencyKey: string }) => m.idempotencyKey === evt.eventId);
    expect(mail).toBeDefined();
    expect(mail.template).toBe('payment-confirmed');

    const metrics = await request(app.getHttpServer()).get('/v1/billing/metrics').set(admin).expect(200);
    expect(metrics.body['billing.webhook.applied']).toBeGreaterThan(0);
  });

  it('replay do webhook = DUPLICATE sem duplicar licença/email', async () => {
    const order = await request(app.getHttpServer())
      .post('/v1/billing/orders')
      .set(admin)
      .send({ customer_id: 'cust-3', product_id: 'prod-1', amount_cents: 7900 })
      .expect(201);
    const externalId = order.body.payment.externalId as string;
    await request(app.getHttpServer()).post('/v1/billing/webhooks/asaas-mock').send(asaasConfirmed(externalId, 79.0)).expect(200);

    const beforeHooks = (await request(app.getHttpServer()).get('/v1/billing/license-hooks').set(admin)).body.length;
    const beforeEmails = (await request(app.getHttpServer()).get('/v1/billing/emails').set(admin)).body.length;

    const replay = await request(app.getHttpServer())
      .post('/v1/billing/webhooks/asaas-mock')
      .send(asaasConfirmed(externalId, 79.0))
      .expect(200);
    expect(replay.body.status).toBe('DUPLICATE');

    const afterHooks = (await request(app.getHttpServer()).get('/v1/billing/license-hooks').set(admin)).body.length;
    const afterEmails = (await request(app.getHttpServer()).get('/v1/billing/emails').set(admin)).body.length;
    expect(afterHooks).toBe(beforeHooks);
    expect(afterEmails).toBe(beforeEmails);

    const metrics = await request(app.getHttpServer()).get('/v1/billing/metrics').set(admin).expect(200);
    expect(metrics.body['billing.webhook.duplicate']).toBeGreaterThan(0);
  });

  it('transição ilegal (PENDING → REFUNDED) = REJECTED + alerta, sem sobrescrever', async () => {
    const order = await request(app.getHttpServer())
      .post('/v1/billing/orders')
      .set(admin)
      .send({ customer_id: 'cust-4', product_id: 'prod-1', amount_cents: 7900 })
      .expect(201);
    const externalId = order.body.payment.externalId as string;

    const illegal = await request(app.getHttpServer())
      .post('/v1/billing/webhooks/asaas-mock')
      .send({ event: 'PAYMENT_REFUNDED', payment: { id: externalId } })
      .expect(200);
    expect(illegal.body.status).toBe('REJECTED');

    const got = await request(app.getHttpServer())
      .get(`/v1/billing/orders/${order.body.order.id}`)
      .set(admin)
      .expect(200);
    expect(got.body.payment.status).toBe('PENDING'); // não sobrescreveu

    const alerts = await request(app.getHttpServer()).get('/v1/billing/alerts').set(admin).expect(200);
    expect(JSON.stringify(alerts.body)).toContain(externalId);

    // Fora de ordem: CONFIRMED aplica; evento antigo (FAILED) depois não regride.
    await request(app.getHttpServer())
      .post('/v1/billing/webhooks/asaas-mock')
      .send(asaasConfirmed(externalId, 79.0))
      .expect(200);
    const stale = await request(app.getHttpServer())
      .post('/v1/billing/webhooks/asaas-mock')
      .send({ event: 'PAYMENT_OVERDUE', payment: { id: externalId } })
      .expect(200);
    expect(stale.body.status).toBe('REJECTED');
    const still = await request(app.getHttpServer())
      .get(`/v1/billing/orders/${order.body.order.id}`)
      .set(admin)
      .expect(200);
    expect(still.body.payment.status).toBe('CONFIRMED');
  });

  it('reconciliação emite sintético recon:<id>:<data> e acusa divergência', () => {
    const { payment } = flow.createOrder({ customerId: 'cust-5', productId: 'prod-1', amountCents: 5000 });
    const out = flow.reconTick(new Date('2026-10-10T12:00:00.000Z'), (externalId) => {
      if (externalId === payment.externalId) return { status: 'CONFIRMED', valueCents: 9999 }; // diverge
      return { status: 'PENDING', valueCents: 5000 };
    });
    expect(out.checked).toBeGreaterThan(0);
    expect(out.divergences).toBeGreaterThan(0);
    expect(out.synthetic.some((id) => id.startsWith('recon:'))).toBe(true);
    expect(flow.listAlerts().some((a) => a.kind === 'billing.recon.diverged')).toBe(true);
  });
});
