import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AdminStubGuard } from '../src/modules/access/admin.guard';
import { AuditService } from '../src/modules/audit/audit.service';
import { FinanceFlowController } from '../src/modules/finance/finance-flow.controller';
import { FinanceFlowService } from '../src/modules/finance/finance-flow.service';
import { FinanceReadGuard } from '../src/modules/finance/finance-read.guard';

// Fluxo financeiro canônico (e2e hermético, sem PG/Redis — mesmo padrão de
// `billing.flow.e2e-spec.ts`):
// PaymentConfirmed (fan-out billing → finance) → Receivable RECEBIDO +
// Transaction INCOME (único mutador de saldo) + saldo; replay = duplicate sem
// duplicar; baixas manuais mark-received/mark-paid idempotentes; projeções
// hit (200) / miss (202 COMPUTING); leitura sem `finance.read` → 403 (stub
// PROJECT.md §3); concessões `finance.read` auditadas sem PII (LGPD.md).
describe('Finance flow (e2e)', () => {
  let app: INestApplication;
  const admin = { 'x-role': 'admin' };
  const fin = (org: string) => ({ 'x-finance-read': org });
  const ORG = 'org-finance-e2e';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [FinanceFlowController],
      providers: [FinanceFlowService, AuditService, AdminStubGuard, FinanceReadGuard],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  function confirmedEvent(n: number, amountCents = 7900) {
    return {
      event_id: `evt-finance-e2e-${n}-confirmado`,
      org_id: ORG,
      external_id: `pay_fin_${n}`,
      amount_cents: amountCents,
      paid_at: '2026-10-10T12:00:00.000Z',
    };
  }

  it('PaymentConfirmed → Receivable RECEBIDO + Transaction INCOME + saldo', async () => {
    const ingest = await request(app.getHttpServer())
      .post('/v1/finance/ingest/payment-confirmed')
      .set(admin)
      .send(confirmedEvent(1))
      .expect(201);
    expect(ingest.body.duplicate).toBe(false);
    expect(ingest.body.receivable.status).toBe('RECEBIDO');
    expect(ingest.body.receivable.orgId).toBe(ORG);
    expect(ingest.body.transaction.kind).toBe('INCOME');
    expect(ingest.body.transaction.amountCents).toBe(7900);

    const balance = await request(app.getHttpServer())
      .get(`/v1/finance/balance?orgId=${ORG}`)
      .set(fin(ORG))
      .expect(200);
    expect(balance.body.balanceCents).toBe(7900);
    expect(balance.body.incomeCents).toBe(7900);
    expect(balance.body.expenseCents).toBe(0);

    const txns = await request(app.getHttpServer())
      .get(`/v1/finance/transactions?orgId=${ORG}`)
      .set(admin)
      .expect(200);
    expect(txns.body.filter((t: { kind: string }) => t.kind === 'INCOME')).toHaveLength(1);

    // Auditoria sem PII: só ator/org/valores operacionais.
    const audit = await request(app.getHttpServer())
      .get('/v1/finance/audit?action=finance.transaction.posted')
      .set(admin)
      .expect(200);
    const entry = audit.body.find((e: { entityId: string }) => e.entityId === ingest.body.transaction.id);
    expect(entry).toBeDefined();
    expect(entry.metadata.orgId).toBe(ORG);
    expect(entry.metadata.amountCents).toBe(7900);
    expect(entry.metadata.eventId).toBe('evt-finance-e2e-1-confirmado');
    for (const row of audit.body as Array<{ metadata: Record<string, unknown> }>) {
      expect(row.metadata).not.toHaveProperty('email');
      expect(row.metadata).not.toHaveProperty('name');
      expect(row.metadata).not.toHaveProperty('cpf');
      expect(row.metadata).not.toHaveProperty('cpfCnpj');
    }
  });

  it('replay do PaymentConfirmed = duplicate sem duplicar', async () => {
    const replay = await request(app.getHttpServer())
      .post('/v1/finance/ingest/payment-confirmed')
      .set(admin)
      .send(confirmedEvent(1))
      .expect(201);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.transaction.id).toBeDefined();

    const balance = await request(app.getHttpServer())
      .get(`/v1/finance/balance?orgId=${ORG}`)
      .set(fin(ORG))
      .expect(200);
    expect(balance.body.balanceCents).toBe(7900); // sem duplo lançamento

    const metrics = await request(app.getHttpServer()).get('/v1/finance/metrics').set(admin).expect(200);
    expect(metrics.body['finance.ingest.duplicate']).toBeGreaterThan(0);
    expect(metrics.body['finance.transaction.posted']).toBe(1);
  });

  it('mark-received manual é idempotente (segunda baixa = no-op)', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/finance/receivables')
      .set(admin)
      .send({ org_id: ORG, amount_cents: 5000, kind: 'pendente' })
      .expect(201);
    expect(created.body.status).toBe('PENDENTE');

    const first = await request(app.getHttpServer())
      .post(`/v1/finance/receivables/${created.body.id}/mark-received`)
      .set(admin)
      .send({ paid_at: '2026-10-10T13:00:00.000Z' })
      .expect(201);
    expect(first.body.status).toBe('RECEBIDO');

    const second = await request(app.getHttpServer())
      .post(`/v1/finance/receivables/${created.body.id}/mark-received`)
      .set(admin)
      .send({ paid_at: '2026-10-10T13:00:00.000Z' })
      .expect(201);
    expect(second.body.status).toBe('RECEBIDO');

    const balance = await request(app.getHttpServer())
      .get(`/v1/finance/balance?orgId=${ORG}`)
      .set(fin(ORG))
      .expect(200);
    expect(balance.body.balanceCents).toBe(7900 + 5000); // 1 Transaction, sem duplicar

    const metrics = await request(app.getHttpServer()).get('/v1/finance/metrics').set(admin).expect(200);
    expect(metrics.body['finance.transaction.posted']).toBe(2);
  });

  it('mark-paid manual é idempotente e reduz o saldo uma única vez', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/finance/payables')
      .set(admin)
      .send({ org_id: ORG, amount_cents: 2000 })
      .expect(201);
    expect(created.body.status).toBe('PENDENTE');

    await request(app.getHttpServer())
      .post(`/v1/finance/payables/${created.body.id}/mark-paid`)
      .set(admin)
      .send({ paid_at: '2026-10-10T14:00:00.000Z' })
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post(`/v1/finance/payables/${created.body.id}/mark-paid`)
      .set(admin)
      .send({ paid_at: '2026-10-10T14:00:00.000Z' })
      .expect(201);
    expect(replay.body.status).toBe('PAGO');

    const balance = await request(app.getHttpServer())
      .get(`/v1/finance/balance?orgId=${ORG}`)
      .set(fin(ORG))
      .expect(200);
    expect(balance.body.balanceCents).toBe(7900 + 5000 - 2000);
    expect(balance.body.expenseCents).toBe(2000);

    const metrics = await request(app.getHttpServer()).get('/v1/finance/metrics').set(admin).expect(200);
    expect(metrics.body['finance.payable.paid']).toBe(1);
  });

  it('projeções: miss → 202, compute → hit 200 com premisesHash', async () => {
    const miss = await request(app.getHttpServer())
      .get(`/v1/finance/projections?orgId=${ORG}&horizonDays=30`)
      .set(fin(ORG))
      .expect(202);
    expect(miss.body.cache).toBe('MISS');
    expect(miss.body.status).toBe('COMPUTING');

    const computed = await request(app.getHttpServer())
      .post('/v1/finance/projections/compute')
      .set(admin)
      .send({ org_id: ORG, horizon_days: 30 })
      .expect(201);
    expect(computed.body.premisesHash).toMatch(/^[0-9a-f]{64}$/);
    expect(computed.body.realizedCents).toBe(7900 + 5000 - 2000);

    const hit = await request(app.getHttpServer())
      .get(`/v1/finance/projections?orgId=${ORG}&horizonDays=30`)
      .set(fin(ORG))
      .expect(200);
    expect(hit.body.cache).toBe('HIT');
    expect(hit.body.snapshot.premisesHash).toBe(computed.body.premisesHash);

    const metrics = await request(app.getHttpServer()).get('/v1/finance/metrics').set(admin).expect(200);
    expect(metrics.body['finance.projection.miss']).toBeGreaterThan(0);
    expect(metrics.body['finance.projection.hit']).toBeGreaterThan(0);
    expect(metrics.body['finance.projection.computed']).toBe(1);
  });

  it('finance.read negado sem permissão (403 stub)', async () => {
    await request(app.getHttpServer()).get(`/v1/finance/balance?orgId=${ORG}`).expect(403);
    await request(app.getHttpServer())
      .get(`/v1/finance/projections?orgId=${ORG}&horizonDays=30`)
      .expect(403);
    // Concessão de outra org não autoriza (escopo).
    await request(app.getHttpServer())
      .get(`/v1/finance/balance?orgId=${ORG}`)
      .set(fin('org-outra'))
      .expect(403);
    // Concessão correta autoriza.
    await request(app.getHttpServer())
      .get(`/v1/finance/balance?orgId=${ORG}`)
      .set(fin(ORG))
      .expect(200);
  });

  it('concessão finance.read é auditada (ator/org/motivo) sem PII', async () => {
    const grant = await request(app.getHttpServer())
      .post('/v1/finance/grants')
      .set(admin)
      .send({ org_id: ORG, grantee: 'manager-1', reason: 'fechamento mensal de outubro' })
      .expect(201);
    expect(grant.body.orgId).toBe(ORG);

    const audit = await request(app.getHttpServer())
      .get('/v1/finance/audit?action=finance.read.grant')
      .set(admin)
      .expect(200);
    const entry = audit.body.find((e: { entityId: string }) => e.entityId === grant.body.id);
    expect(entry).toBeDefined();
    expect(entry.action).toBe('finance.read.grant');
    expect(entry.metadata.orgId).toBe(ORG);
    expect(entry.metadata.reason).toBe('fechamento mensal de outubro');
    expect(entry.metadata).not.toHaveProperty('email');
    expect(entry.metadata).not.toHaveProperty('granteeEmail');
  });
});
