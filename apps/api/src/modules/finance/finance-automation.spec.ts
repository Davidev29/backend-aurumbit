import { FinanceAutomationService } from './finance-automation.service';

// Orquestrador com PG mockado (sem banco) + fakes de FinanceService,
// notificações, provider e audit. Convenção do mock: responde por
// prefixo/conteúdo do SQL (mesmo padrão de finance.service.spec.ts).

function mockPool(handler: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] }) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const q = async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    const out = handler(sql, params);
    return { rows: out.rows as unknown as never[], rowCount: 1 };
  };
  return { pool: { query: q }, queries };
}

function jobRow(over: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    idempotencyKey: 'key-12345678',
    orgId: 'org-1',
    kind: 'BILL_PAY',
    payableId: 'pay-1',
    receivableId: null,
    barcodeMasked: '0019…5000 (47d)',
    scheduleDate: '2026-11-10',
    provider: 'ASAAS',
    externalId: null,
    status: 'QUEUED',
    attempts: 0,
    lastError: null,
    ...over,
  };
}

const PAYABLE = { id: 'pay-1', orgId: 'org-1', status: 'PREVISTO', amountCents: 5000 };
const RECEIVABLE = { id: 'rec-1', orgId: 'org-1', status: 'PENDENTE', amountCents: 14990 };
const LINE47 = '00190000090275928800021932978170187890000005000';

function harness(opts: {
  poolHandler: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] };
  provider?: {
    createBillPayment?: (i: never) => Promise<{ id: string; status: string }>;
    createCharge?: (i: never) => Promise<{ id: string; status: string }>;
    getChargeIdentificationField?: (id: string) => Promise<{ identificationField: string | null; barCode: string | null; nossoNumero: string | null }>;
  };
}) {
  const { pool, queries } = mockPool(opts.poolHandler);
  const notified: Array<Record<string, unknown>> = [];
  const finance = {
    createPayable: jest.fn(async () => PAYABLE),
    createReceivable: jest.fn(async () => RECEIVABLE),
    getPayable: jest.fn(async () => PAYABLE),
    getReceivable: jest.fn(async () => RECEIVABLE),
  };
  const notifications = {
    notify: jest.fn(async (i: Record<string, unknown>) => {
      notified.push(i);
      return { id: 'notif-1', ...i };
    }),
    list: jest.fn(),
    markRead: jest.fn(),
  };
  const provider = {
    createBillPayment: jest.fn(
      opts.provider?.createBillPayment ?? (async () => ({ id: 'bill-1', status: 'SCHEDULED' })),
    ),
    createCharge: jest.fn(opts.provider?.createCharge ?? (async () => ({ id: 'pay_1', status: 'PENDING' }))),
    getChargeIdentificationField: jest.fn(
      opts.provider?.getChargeIdentificationField ?? (async () => ({ identificationField: LINE47, barCode: null, nossoNumero: null })),
    ),
  };
  const audit = { emit: jest.fn(() => ({ id: 'aud-1' })) };
  const svc = new FinanceAutomationService(
    pool as never,
    finance as never,
    notifications as never,
    provider as never,
    audit as never,
  );
  return { svc, queries, notified, finance, provider, audit };
}

const EXPENSE = {
  supplier: 'Energia S.A.',
  amountCents: 5000,
  dueDate: '2099-01-10T00:00:00.000Z',
  barcode: LINE47,
  payViaAsaas: true,
};

function poolForNewJob() {
  let claimed = false;
  return (sql: string) => {
    if (sql.includes('FROM finance_automation_jobs WHERE "orgId"')) return { rows: [] };
    if (sql.startsWith('INSERT INTO finance_automation_jobs')) {
      claimed = true;
      return { rows: [jobRow()] };
    }
    if (sql.startsWith('UPDATE finance_automation_jobs')) {
      return { rows: [jobRow({ status: sql.includes("'SCHEDULED'") ? 'SCHEDULED' : 'RUNNING' })] };
    }
    void claimed;
    return { rows: [] };
  };
}

describe('FinanceAutomationService — despesas', () => {
  it('replay pela mesma chave retorna sem recriar nem rechamar o provider', async () => {
    const done = jobRow({ status: 'SCHEDULED', externalId: 'bill-1' });
    const { svc, provider, finance } = harness({
      poolHandler: (sql) =>
        sql.includes('FROM finance_automation_jobs') ? { rows: [done] } : { rows: [] },
    });
    const out = await svc.createExpense('org-1', EXPENSE as never, 'key-12345678');
    expect(out.duplicate).toBe(true);
    expect(out.viaAsaas).toBe(true);
    expect(finance.createPayable).not.toHaveBeenCalled();
    expect(provider.createBillPayment).not.toHaveBeenCalled();
  });

  it('despesa futura agenda via Asaas + notifica (sem tocar em saldo)', async () => {
    const { svc, queries, notified, provider } = harness({ poolHandler: poolForNewJob() });
    const out = await svc.createExpense('org-1', EXPENSE as never, 'key-12345678');
    expect(out.duplicate).toBe(false);
    expect(out.viaAsaas).toBe(true);
    expect(provider.createBillPayment).toHaveBeenCalledTimes(1);
    expect(notified.some((n) => n.kind === 'BILL_SCHEDULED')).toBe(true);
    expect(queries.some((q) => q.sql.includes('balanceCents'))).toBe(false);
  });

  it('barcode inválido → 422 antes de qualquer escrita', async () => {
    const { svc, finance, provider } = harness({ poolHandler: () => ({ rows: [] }) });
    await expect(
      svc.createExpense('org-1', { ...EXPENSE, barcode: '123' } as never, 'key-12345678'),
    ).rejects.toThrow(/código de barras|44/);
    expect(finance.createPayable).not.toHaveBeenCalled();
    expect(provider.createBillPayment).not.toHaveBeenCalled();
  });

  it('barcode fora do Bill Payments → fallback manual (CANCELED + WARN, sem throw)', async () => {
    // Barra 44 (exemplo docs Asaas) cai no fallback — Bill Payments opera
    // por linha digitável (47/48).
    const bar44 = '00191878900000050000000002759288002193297817';
    const { svc, notified } = harness({
      poolHandler: (sql) => {
        if (sql.includes('FROM finance_automation_jobs')) return { rows: [] };
        if (sql.startsWith('INSERT INTO finance_automation_jobs')) return { rows: [jobRow({ barcodeMasked: '0019…0100 (44d)' })] };
        if (sql.startsWith('UPDATE finance_automation_jobs')) return { rows: [jobRow({ status: 'CANCELED' })] };
        return { rows: [] };
      },
    });
    const out = await svc.createExpense(
      'org-1',
      { supplier: 'X', amountCents: 100, dueDate: '2099-01-10T00:00:00.000Z', barcode: bar44, payViaAsaas: true } as never,
      'key-12345678',
    );
    expect(out.viaAsaas).toBe(false);
    expect(notified.some((n) => n.severity === 'WARN')).toBe(true);
  });

  it('falha transitória → FAILED + notifica ERROR + throw p/ retry', async () => {
    const { svc, notified } = harness({
      poolHandler: poolForNewJob(),
      provider: {
        createBillPayment: async () => {
          throw new Error('Asaas POST /billPayments → HTTP 503 (retry)');
        },
      },
    });
    await expect(svc.createExpense('org-1', EXPENSE as never, 'key-12345678')).rejects.toThrow(/503/);
    expect(notified.some((n) => n.kind === 'BILL_PAY_FAILED' && n.severity === 'ERROR')).toBe(true);
  });
});

describe('FinanceAutomationService — receitas automáticas', () => {
  it('emite cobrança Asaas + retorna linha digitável + notifica', async () => {
    const { svc, notified, provider } = harness({
      poolHandler: (sql) => {
        if (sql.includes('FROM finance_automation_jobs')) return { rows: [] };
        if (sql.startsWith('INSERT INTO finance_automation_jobs')) {
          return { rows: [jobRow({ kind: 'AUTO_CHARGE', payableId: null, receivableId: 'rec-1' })] };
        }
        if (sql.startsWith('UPDATE finance_automation_jobs')) {
          return { rows: [jobRow({ kind: 'AUTO_CHARGE', status: 'DONE', externalId: 'pay_1' })] };
        }
        return { rows: [] };
      },
    });
    const out = await svc.createReceivableAuto(
      'org-1',
      {
        customerName: 'Alice',
        asaasCustomerId: 'cus_1',
        amountCents: 14990,
        dueDate: '2099-02-10T00:00:00.000Z',
        billingType: 'BOLETO',
      } as never,
      'key-87654321',
    );
    expect(out.duplicate).toBe(false);
    expect(out.chargeId).toBe('pay_1');
    expect(out.identificationField).toBe(LINE47);
    expect(provider.createCharge).toHaveBeenCalledTimes(1);
    expect(notified.some((n) => n.kind === 'CHARGE_ISSUED')).toBe(true);
  });

  it('replay não recobra', async () => {
    const done = jobRow({ kind: 'AUTO_CHARGE', status: 'DONE', receivableId: 'rec-1', externalId: 'pay_1' });
    const { svc, provider } = harness({
      poolHandler: (sql) =>
        sql.includes('FROM finance_automation_jobs') ? { rows: [done] } : { rows: [] },
    });
    const out = await svc.createReceivableAuto(
      'org-1',
      { customerName: 'A', asaasCustomerId: 'cus_1', amountCents: 100, dueDate: '2099-01-01T00:00:00.000Z' } as never,
      'key-87654321',
    );
    expect(out.duplicate).toBe(true);
    expect(provider.createCharge).not.toHaveBeenCalled();
  });
});

describe('FinanceAutomationService — replay interno (worker)', () => {
  it('replayBillPay em job DONE → duplicate sem rechamar o provider', async () => {
    const done = jobRow({ status: 'DONE', externalId: 'bill-1' });
    const { svc, provider } = harness({
      poolHandler: (sql) =>
        sql.includes('FROM finance_automation_jobs') ? { rows: [done] } : { rows: [] },
    });
    const out = await svc.replayBillPay('org-1', { idempotencyKey: 'key-12345678' });
    expect(out.duplicate).toBe(true);
    expect(provider.createBillPayment).not.toHaveBeenCalled();
  });

  it('replayBillPay em job FAILED reexecuta com o payload do job-data', async () => {
    const failed = jobRow({ status: 'FAILED', lastError: 'HTTP 503' });
    const { svc, provider } = harness({
      poolHandler: (sql) => {
        if (sql.includes('FROM finance_automation_jobs')) return { rows: [failed] };
        if (sql.startsWith('UPDATE finance_automation_jobs')) {
          return { rows: [jobRow({ status: 'SCHEDULED', externalId: 'bill-9' })] };
        }
        return { rows: [] };
      },
    });
    const out = await svc.replayBillPay('org-1', {
      idempotencyKey: 'key-12345678',
      barcode: LINE47,
      scheduleDate: '2099-03-10',
    });
    expect(out.duplicate).toBe(false);
    expect(out.job.externalId).toBe('bill-9');
    expect(provider.createBillPayment).toHaveBeenCalledTimes(1);
  });

  it('replayBillPay sem job → 400 (poison p/ DLQ, sem retry)', async () => {
    const { svc, provider } = harness({ poolHandler: () => ({ rows: [] }) });
    await expect(svc.replayBillPay('org-1', { idempotencyKey: 'key-00000000' })).rejects.toThrow(/não encontrado/);
    expect(provider.createBillPayment).not.toHaveBeenCalled();
  });

  it('replayAutoCharge em job DONE → duplicate sem recobrar', async () => {
    const done = jobRow({ kind: 'AUTO_CHARGE', status: 'DONE', receivableId: 'rec-1', externalId: 'pay_1' });
    const { svc, provider } = harness({
      poolHandler: (sql) =>
        sql.includes('FROM finance_automation_jobs') ? { rows: [done] } : { rows: [] },
    });
    const out = await svc.replayAutoCharge('org-1', { idempotencyKey: 'key-87654321' });
    expect(out.duplicate).toBe(true);
    expect(provider.createCharge).not.toHaveBeenCalled();
  });

  it('concorrência (duplo clique): só um executor chama o provider', async () => {
    // PG stateful: INSERT ON CONFLICT + CAS QUEUED/FAILED→RUNNING atômicos.
    const store = new Map<string, Record<string, unknown>>();
    const poolHandler = (sql: string) => {
      if (sql.includes('FROM finance_automation_jobs WHERE "orgId"')) {
        const found = [...store.values()].find((j) => j.orgId === 'org-1' && j.idempotencyKey === 'key-race-1234');
        return { rows: found ? [found] : [] };
      }
      if (sql.startsWith('INSERT INTO finance_automation_jobs')) {
        const existing = [...store.values()].find((j) => j.idempotencyKey === 'key-race-1234');
        if (existing) return { rows: [] }; // ON CONFLICT DO NOTHING
        const row = jobRow({ idempotencyKey: 'key-race-1234', status: 'QUEUED' });
        store.set(row.id as string, row);
        return { rows: [row] };
      }
      if (sql.includes("SET status = 'RUNNING'")) {
        const row = store.get('job-1');
        if (row && (row.status === 'QUEUED' || row.status === 'FAILED')) {
          const owned = { ...row, status: 'RUNNING' };
          store.set('job-1', owned);
          return { rows: [owned] };
        }
        return { rows: [] }; // perdedor da race
      }
      if (sql.startsWith('UPDATE finance_automation_jobs')) {
        const row = store.get('job-1') ?? jobRow();
        const done = { ...row, status: 'SCHEDULED', externalId: 'bill-race' };
        store.set('job-1', done);
        return { rows: [done] };
      }
      return { rows: [] };
    };
    const { svc, provider } = harness({ poolHandler });
    const req = {
      supplier: 'Race S.A.',
      amountCents: 100,
      dueDate: '2099-05-10T00:00:00.000Z',
      barcode: LINE47,
      payViaAsaas: true,
    } as never;
    const [a, b] = await Promise.all([
      svc.createExpense('org-1', req, 'key-race-1234'),
      svc.createExpense('org-1', req, 'key-race-1234'),
    ]);
    expect(provider.createBillPayment).toHaveBeenCalledTimes(1);
    expect([a.duplicate, b.duplicate].filter(Boolean)).toHaveLength(1);
  });
});
