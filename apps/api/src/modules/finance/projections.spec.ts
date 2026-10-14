/**
 * Projeções financeiras — testes (Fase 5):
 * cálculo com fixtures + cache hit/miss + caminho 202 + guard.
 * Sem banco, sem Redis (tudo em memória).
 */

import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  DEFAULT_PREMISES,
  ProjectionInputs,
  computeProjection,
  expandSubscriptionInstallments,
  hashPremises,
  periodFor,
} from './projections.compute';
import { FinanceProjectionsGuard } from './projections.guard';
import { ProjectionMetrics } from './projections.metrics';
import { InMemoryProjectionQueue, projectionJobId } from './projections.queue';
import { InMemoryProjectionSource } from './projections.source';
import { InMemoryProjectionStore, ProjectionJobRegistry } from './projections.store';
import { ProjectionsService } from './projections.service';

function buildService(inputs: ProjectionInputs): {
  svc: ProjectionsService;
  queue: InMemoryProjectionQueue;
  store: InMemoryProjectionStore;
  metrics: ProjectionMetrics;
} {
  const source = new InMemoryProjectionSource();
  source.setInputs(inputs);
  const store = new InMemoryProjectionStore();
  const queue = new InMemoryProjectionQueue();
  const metrics = new ProjectionMetrics();
  const svc = new ProjectionsService(source, store, queue, new ProjectionJobRegistry(), metrics);
  return { svc, queue, store, metrics };
}

/** Fixture do aceite: mensal Nov/2026 (valores conferidos à mão). */
function novemberInputs(): ProjectionInputs {
  return {
    receivables: [
      // PREVISTO PIX 10000, lag D+0 → caixa Nov: 10000×0.6 = 6000.
      { id: 'r1', amountCents: 10000, status: 'PREVISTO', method: 'PIX', dueDate: '2026-11-10T12:00:00Z', accountId: 'acc-a', category: 'sales' },
      // PENDENTE BOLETO 5000, venc Nov: 5000×(1−0.08) = 4600.
      { id: 'r2', amountCents: 5000, status: 'PENDENTE', method: 'BOLETO', dueDate: '2026-11-20T12:00:00Z', accountId: 'acc-b', category: 'sales' },
      // Status terminal/inesperado: ignorado pelo cálculo.
      { id: 'r3', amountCents: 99999, status: 'CANCELLED', method: 'PIX', dueDate: '2026-11-10T12:00:00Z' },
    ],
    payables: [
      // PREVISTO integral 4000.
      { id: 'p1', amountCents: 4000, status: 'PREVISTO', dueDate: '2026-11-12T12:00:00Z', accountId: 'acc-a', category: 'ops' },
    ],
    subscriptions: [
      // ACTIVE MONTHLY 3000, nextDue Nov: 3000×0.6×1 = 1800 (só 1 parcela no mês).
      { id: 's1', status: 'ACTIVE', amountCents: 3000, nextDueDate: '2026-11-01T03:00:00Z', billingCycle: 'MONTHLY', method: 'CREDIT_CARD', accountId: 'acc-a', category: 'recurring' },
      // CANCELLED: ignorada.
      { id: 's2', status: 'CANCELLED', amountCents: 50000, nextDueDate: '2026-11-01T03:00:00Z', billingCycle: 'MONTHLY' },
    ],
    transactions: [
      { id: 't1', amountCents: 2000, kind: 'CREDIT', occurredAt: '2026-11-05T12:00:00Z', accountId: 'acc-a', category: 'sales' },
      { id: 't2', amountCents: 500, kind: 'DEBIT', occurredAt: '2026-11-06T12:00:00Z', accountId: 'acc-a', category: 'ops' },
      // Fora do período: ignorada.
      { id: 't3', amountCents: 777, kind: 'CREDIT', occurredAt: '2026-10-31T12:00:00Z' },
    ],
  };
}

describe('projections.compute — cálculo com fixtures', () => {
  it('mensal Nov/2026: previsto/pendente/realizado/líquido + por conta/categoria', () => {
    const snap = computeProjection({
      scope: 'monthly',
      refDate: '2026-11-15',
      tz: 'America/Sao_Paulo',
      inputs: novemberInputs(),
    });
    expect(snap.premisesHash).toBe(hashPremises(DEFAULT_PREMISES));
    expect(snap.byMonth).toHaveLength(1);
    expect(snap.byMonth[0].month).toBe('2026-11');

    const t = snap.totals;
    expect(t.previstoReceita).toBe(7800); // 6000 títulos + 1800 assinatura
    expect(t.previstoDespesa).toBe(4000);
    expect(t.previstoNet).toBe(3800);
    expect(t.pendenteReceita).toBe(4600);
    expect(t.pendenteDespesa).toBe(0);
    expect(t.pendenteNet).toBe(4600);
    expect(t.realizadoCredito).toBe(2000);
    expect(t.realizadoDebito).toBe(500);
    expect(t.realizadoNet).toBe(1500);
    expect(t.liquido).toBe(9900); // 3800 + 4600 + 1500

    expect(snap.byAccount['acc-a'].liquido).toBe(5300); // 3800 + 0 + 1500
    expect(snap.byAccount['acc-b'].liquido).toBe(4600);
    expect(snap.byCategory['sales'].liquido).toBe(12600); // 6000 + 4600 + 2000
    expect(snap.byCategory['recurring'].liquido).toBe(1800); // parcela futura S1
    expect(snap.byCategory['ops'].liquido).toBe(-4500); // −4000 + 0 − 500
    expect(snap.inputCounts).toMatchObject({ receivables: 3, subscriptions: 2, installments: 1 });
  });

  it('inadimplência pondera por método (PIX 2% / CC 5%)', () => {
    const snap = computeProjection({
      scope: 'monthly',
      refDate: '2026-11-15',
      tz: 'America/Sao_Paulo',
      inputs: {
        receivables: [
          { id: 'a', amountCents: 10000, status: 'PENDENTE', method: 'PIX', dueDate: '2026-11-10T12:00:00Z' },
          { id: 'b', amountCents: 10000, status: 'PENDENTE', method: 'CREDIT_CARD', dueDate: '2026-11-10T12:00:00Z' },
        ],
        payables: [],
        subscriptions: [],
        transactions: [],
      },
    });
    expect(snap.totals.pendenteReceita).toBe(9800 + 9500);
  });

  it('settlement desloca a data de caixa: boleto D+2 no limite do mês', () => {
    const boletoLimite = {
      receivables: [
        { id: 'x', amountCents: 10000, status: 'PREVISTO', method: 'BOLETO' as const, dueDate: '2026-11-30T12:00:00Z' },
      ],
      payables: [],
      subscriptions: [],
      transactions: [],
    };
    // Mensal Nov: caixa cai em 02/Dez → fora do período.
    const nov = computeProjection({ scope: 'monthly', refDate: '2026-11-15', tz: 'America/Sao_Paulo', inputs: boletoLimite });
    expect(nov.totals.previstoReceita).toBe(0);
    // Trimestral Q4: cai no bucket de Dezembro (10000×0.6 = 6000).
    const q4 = computeProjection({ scope: 'quarterly', refDate: '2026-10-15', tz: 'America/Sao_Paulo', inputs: boletoLimite });
    expect(q4.byMonth).toHaveLength(3);
    expect(q4.byMonth[1].month).toBe('2026-11');
    expect(q4.byMonth[1].previstoReceita).toBe(0);
    expect(q4.byMonth[2].month).toBe('2026-12');
    expect(q4.byMonth[2].previstoReceita).toBe(6000);
  });

  it('expansão anual com churn: 12 parcelas decaídas (total 102052)', () => {
    const snap = computeProjection({
      scope: 'annual',
      refDate: '2026-06-01',
      tz: 'America/Sao_Paulo',
      premises: { ...DEFAULT_PREMISES, churnMonthly: 0.03, conversionRate: 1 },
      inputs: {
        receivables: [],
        payables: [],
        subscriptions: [
          { id: 's', status: 'ACTIVE', amountCents: 10000, nextDueDate: '2026-01-05T12:00:00Z', billingCycle: 'MONTHLY' },
        ],
        transactions: [],
      },
    });
    expect(snap.byMonth).toHaveLength(12);
    expect(snap.byMonth[0].previstoReceita).toBe(10000);
    expect(snap.byMonth[1].previstoReceita).toBe(9700);
    expect(snap.byMonth[11].previstoReceita).toBe(7153);
    expect(snap.totals.previstoReceita).toBe(102052);
  });

  it('expansão respeita o teto de 12 parcelas mesmo em período longo', () => {
    const { start } = periodFor('annual', '2026-01-15', 'America/Sao_Paulo');
    const end = new Date(Date.UTC(2028, 0, 1, 3, 0, 0)); // 24 meses
    const inst = expandSubscriptionInstallments(
      { id: 's', status: 'ACTIVE', amountCents: 1000, nextDueDate: '2026-01-05T12:00:00Z', billingCycle: 'MONTHLY' },
      start,
      end,
      DEFAULT_PREMISES,
    );
    expect(inst).toHaveLength(12);
  });

  it('premisesHash é estável e sensível às premissas', () => {
    const a = hashPremises(DEFAULT_PREMISES);
    expect(hashPremises({ ...DEFAULT_PREMISES })).toBe(a);
    expect(hashPremises({ ...DEFAULT_PREMISES, churnMonthly: 0.05 })).not.toBe(a);
  });

  it('entradas inválidas rejeitam (scope/ref/tz)', () => {
    const base = { refDate: '2026-11-15', tz: 'America/Sao_Paulo', inputs: novemberInputs() };
    expect(() => computeProjection({ ...base, scope: 'weekly' as never })).toThrow();
    expect(() => computeProjection({ ...base, scope: 'monthly', refDate: '2026-13-40' })).toThrow();
    expect(() => computeProjection({ ...base, scope: 'monthly', refDate: '2026-02-30' })).toThrow();
    expect(() => computeProjection({ ...base, scope: 'monthly', tz: 'UTC' })).toThrow();
  });
});

describe('projections.service — cache hit/miss + 202', () => {
  it('miss computa inline (200 cached:false); 2ª leitura é hit (cached:true)', async () => {
    const { svc, metrics } = buildService(novemberInputs());
    const q = { scope: 'monthly', ref: '2026-11-15', tz: 'America/Sao_Paulo' };
    const first = await svc.getProjection(q);
    expect(first.httpStatus).toBe(200);
    if (first.httpStatus !== 200) throw new Error('esperado 200');
    expect(first.body.cached).toBe(false);
    expect(first.body.snapshot.totals.liquido).toBe(9900);

    const second = await svc.getProjection(q);
    expect(second.httpStatus).toBe(200);
    if (second.httpStatus !== 200) throw new Error('esperado 200');
    expect(second.body.cached).toBe(true);
    expect(second.body.snapshot.totals.liquido).toBe(9900);

    expect(metrics.snapshot()).toMatchObject({
      'finance.projection.requested': 2,
      'finance.projection.hit': 1,
      'finance.projection.miss': 1,
      'finance.projection.computed': 1,
    });
  });

  it('miss pesado (forceQueue) → 202 + jobId scope:ref:hash; polling pending → internal compute → done → hit', async () => {
    const source = new InMemoryProjectionSource();
    source.setInputs(novemberInputs());
    const store = new InMemoryProjectionStore();
    const queue = new InMemoryProjectionQueue();
    const metrics = new ProjectionMetrics();
    const jobs = new ProjectionJobRegistry();
    const svc = new ProjectionsService(source, store, queue, jobs, metrics);

    const miss = await svc.getProjection(
      { scope: 'monthly', ref: '2026-11-15', tz: 'America/Sao_Paulo' },
      { forceQueue: true },
    );
    expect(miss.httpStatus).toBe(202);
    if (miss.httpStatus !== 202) throw new Error('esperado 202');
    const expectedJobId = projectionJobId('monthly', '2026-11-15', hashPremises(DEFAULT_PREMISES));
    expect(miss.body.jobId).toBe(expectedJobId);
    expect(queue.added).toHaveLength(1);
    expect(queue.added[0].opts).toMatchObject({ jobId: expectedJobId });
    expect(metrics.get('finance.projection.queued')).toBe(1);

    // Polling: pendente antes do worker.
    expect(svc.getJob(expectedJobId).status).toBe('pending');

    // Worker (via endpoint interno): computa + upsert idempotente.
    const stored = await svc.computeAndStore('monthly', '2026-11-15', 'America/Sao_Paulo');
    expect(stored.totals.liquido).toBe(9900);
    expect(svc.getJob(expectedJobId).status).toBe('done');

    // Próximo GET é hit.
    const after = await svc.getProjection({ scope: 'monthly', ref: '2026-11-15', tz: 'America/Sao_Paulo' });
    expect(after.httpStatus).toBe(200);
    if (after.httpStatus !== 200) throw new Error('esperado 200');
    expect(after.body.cached).toBe(true);
  });

  it('volume acima do teto vai p/ fila sem forceQueue', async () => {
    const { svc } = buildService(novemberInputs());
    svc.inlineMaxInputs = 1; // força caminho assíncrono
    const out = await svc.getProjection({ scope: 'monthly', ref: '2026-11-15', tz: 'America/Sao_Paulo' });
    expect(out.httpStatus).toBe(202);
  });

  it('recompute (manage) invalida o snapshot e enfileira; transaction-posted invalida o período', async () => {
    const { svc, queue, metrics } = buildService(novemberInputs());
    await svc.getProjection({ scope: 'monthly', ref: '2026-11-15', tz: 'America/Sao_Paulo' });
    const re = await svc.recompute({ scope: 'monthly', ref: '2026-11-15', tz: 'America/Sao_Paulo' });
    expect(re.invalidated).toBe(1);
    expect(re.jobs).toHaveLength(1);
    expect(queue.added.length).toBeGreaterThanOrEqual(1);
    expect(metrics.get('finance.projection.invalidated')).toBe(1);

    // Snapshot foi invalidado → próximo GET é miss (recomputa inline).
    const afterRe = await svc.getProjection({ scope: 'monthly', ref: '2026-11-15', tz: 'America/Sao_Paulo' });
    if (afterRe.httpStatus !== 200) throw new Error('esperado 200');
    expect(afterRe.body.cached).toBe(false);

    const posted = await svc.handleTransactionPosted('2026-11-20T12:00:00Z');
    expect(posted.invalidated).toBe(1);
    // Fora do período não invalida nada.
    await svc.getProjection({ scope: 'monthly', ref: '2026-11-15', tz: 'America/Sao_Paulo' });
    const outside = await svc.handleTransactionPosted('2027-01-05T12:00:00Z');
    expect(outside.invalidated).toBe(0);
  });

  it('queries inválidas → 400 com código', async () => {
    const { svc } = buildService(novemberInputs());
    await expect(svc.getProjection({ scope: 'weekly', ref: '2026-11-15' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_SCOPE' }),
    });
    await expect(svc.getProjection({ scope: 'monthly', ref: 'ontem' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_REF' }),
    });
    await expect(
      svc.getProjection({ scope: 'monthly', ref: '2026-11-15', tz: 'UTC' }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'UNSUPPORTED_TZ' }) });
    expect(() => svc.getJob('monthly:2026-11-15:desconhecido')).toThrow();
  });
});

describe('projections.guard — finance.read explícito / finance.manage só admin', () => {
  const reflector = new Reflector();

  function ctxWith(roles: string[] | undefined, headers: Record<string, unknown>, scopes: Array<'finance.read' | 'finance.manage'>) {
    const guard = new FinanceProjectionsGuard(reflector);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(scopes);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: roles ? { roles } : undefined, headers }),
      }),
    } as never;
    return { guard, context };
  }

  it('leitura: finance.read, STAFF_FINANCE ou x-role passam; sem credencial → 403', () => {
    expect(ctxWith(['finance.read'], {}, ['finance.read']).guard.canActivate(ctxWith(['finance.read'], {}, ['finance.read']).context)).toBe(true);
    const { guard, context } = ctxWith(['STAFF_FINANCE'], {}, ['finance.read']);
    expect(guard.canActivate(context)).toBe(true);
    const stub = ctxWith(undefined, { 'x-role': 'finance' }, ['finance.read']);
    expect(stub.guard.canActivate(stub.context)).toBe(true);
    const anon = ctxWith(undefined, {}, ['finance.read']);
    expect(() => anon.guard.canActivate(anon.context)).toThrow(ForbiddenException);
  });

  it('recompute: só finance.manage/admin; finance.read sozinho → 403', () => {
    const manage = ctxWith(['finance.manage'], {}, ['finance.manage']);
    expect(manage.guard.canActivate(manage.context)).toBe(true);
    const admin = ctxWith(undefined, { 'x-role': 'admin' }, ['finance.manage']);
    expect(admin.guard.canActivate(admin.context)).toBe(true);
    const reader = ctxWith(['finance.read'], {}, ['finance.manage']);
    expect(() => reader.guard.canActivate(reader.context)).toThrow(ForbiddenException);
    const finStub = ctxWith(undefined, { 'x-role': 'finance' }, ['finance.manage']);
    expect(() => finStub.guard.canActivate(finStub.context)).toThrow(ForbiddenException);
  });
});
