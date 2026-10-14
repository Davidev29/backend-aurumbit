// Testes da reconciliação (Fase 4, PROJECT.md §5).
// Sem PG/Rede/Asaas: fakes em memória.

import { BillingReconciliationCron } from './reconcile.cron';
import { BillingReconciliationService, ReconMetrics } from './reconcile.service';
import {
  HOURLY_WINDOW_DAYS,
  DAILY_WINDOW_DAYS,
  comparePayment,
  dayOf,
  isReconEvent,
  msUntilNextDaily3hSP,
  reconEventId,
  windowCutoff,
} from './reconcile.transitions';
import { InMemoryWebhookQueue } from './webhook.queue';

interface PendingRow {
  externalId: string;
  status: string;
  amountCents: number;
  createdAt: string;
}

function makeFakeDb(pendings: PendingRow[], existing: string[] = []) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes("status IN ('PENDING', 'FAILED')")) {
        const [cutoff, limit, offset] = params as [string, number, number];
        const rows = pendings
          .filter((p) => p.createdAt >= cutoff)
          .slice(offset, offset + limit)
          .map((p) => ({
            id: `db-${p.externalId}`,
            externalId: p.externalId,
            status: p.status,
            amountCents: p.amountCents,
            createdAt: p.createdAt,
          }));
        return { rowCount: rows.length, rows };
      }
      if (sql.includes('FROM payments WHERE provider')) {
        const id = String(params?.[0]);
        const found = pendings.some((p) => p.externalId === id) || existing.includes(id);
        return found ? { rowCount: 1, rows: [{ id }] } : { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
}

function makeAsaas(
  remote: Record<string, { status: string; valueCents: number }>,
  extra: Array<{ id: string; status: string; valueCents: number }> = [],
) {
  return {
    async getPaymentStatus(id: string) {
      const r = remote[id];
      if (!r) throw new Error(`404 asaas ${id}`);
      return { id, status: r.status, valueCents: r.valueCents };
    },
    async listPayments(params: { offset?: number; limit?: number } = {}) {
      const all = [...Object.entries(remote).map(([id, r]) => ({ id, ...r })), ...extra];
      const offset = params.offset ?? 0;
      const limit = params.limit ?? 100;
      const data = all.slice(offset, offset + limit);
      return { data, hasMore: offset + limit < all.length };
    },
  };
}

function makeMetrics(): ReconMetrics & { calls: Array<{ n: string; by: number }> } {
  const calls: Array<{ n: string; by: number }> = [];
  return { calls, inc: (n, by = 1) => void calls.push({ n, by }) };
}

const NOW = new Date('2026-10-10T12:00:00.000Z');
const DAY = '2026-10-10';

describe('reconEventId (sintético, mesmo pipeline)', () => {
  it('formato `recon:<id>:<data>`; dayOf/windowCutoff determinísticos', () => {
    expect(reconEventId('pay_1', DAY)).toBe('recon:pay_1:2026-10-10');
    expect(isReconEvent('recon:pay_1:2026-10-10')).toBe(true);
    expect(isReconEvent('wh:asaas:PAYMENT_CONFIRMED:pay_1')).toBe(false);
    expect(dayOf(NOW)).toBe(DAY);
    expect(windowCutoff(NOW, 7)).toBe('2026-10-03T12:00:00.000Z');
    expect(windowCutoff(NOW, 30)).toBe('2026-09-10T12:00:00.000Z');
  });
});

describe('comparePayment', () => {
  it('match exato (incl. RECEIVED≡CONFIRMED, OVERDUE≡FAILED)', () => {
    expect(
      comparePayment({
        localStatus: 'PENDING',
        localAmountCents: 100,
        remoteStatus: 'PENDING',
        remoteAmountCents: 100,
      }).match,
    ).toBe(true);
    expect(
      comparePayment({
        localStatus: 'CONFIRMED',
        localAmountCents: 100,
        remoteStatus: 'RECEIVED',
        remoteAmountCents: 100,
      }).match,
    ).toBe(true);
    expect(
      comparePayment({
        localStatus: 'FAILED',
        localAmountCents: 50,
        remoteStatus: 'OVERDUE',
        remoteAmountCents: 50,
      }).match,
    ).toBe(true);
  });
  it('divergência de valor e estado desconhecido', () => {
    const v = comparePayment({
      localStatus: 'PENDING',
      localAmountCents: 100,
      remoteStatus: 'PENDING',
      remoteAmountCents: 99,
    });
    expect(v.match).toBe(false);
    expect(v.divergences.join('|')).toContain('valor:100-vs-99');
    const u = comparePayment({
      localStatus: 'PENDING',
      localAmountCents: 100,
      remoteStatus: 'CHARGEBACK_X',
      remoteAmountCents: 100,
    });
    expect(u.match).toBe(false);
    expect(u.divergences.join('|')).toContain('status-remoto-desconhecido');
  });
  it('remoto antigo nunca regride terminal (vira divergência, não transição)', () => {
    const r = comparePayment({
      localStatus: 'CONFIRMED',
      localAmountCents: 100,
      remoteStatus: 'PENDING',
      remoteAmountCents: 100,
    });
    expect(r.match).toBe(false);
    expect(r.divergences.join('|')).toContain('remoto-antigo');
  });
});

describe('runOnce (hourly <7d / daily 30d)', () => {
  const pendings: PendingRow[] = [
    {
      externalId: 'payA',
      status: 'PENDING',
      amountCents: 10000,
      createdAt: '2026-10-09T10:00:00.000Z',
    }, // remoto CONFIRMED → recon
    {
      externalId: 'payB',
      status: 'PENDING',
      amountCents: 5000,
      createdAt: '2026-10-09T11:00:00.000Z',
    }, // remoto PENDING → noop
    {
      externalId: 'payC',
      status: 'PENDING',
      amountCents: 7000,
      createdAt: '2026-10-09T12:00:00.000Z',
    }, // valor diverge → alerta
    {
      externalId: 'payOld',
      status: 'PENDING',
      amountCents: 100,
      createdAt: '2026-09-15T10:00:00.000Z',
    }, // fora da janela hourly, dentro da daily
  ];
  const remote = {
    payA: { status: 'CONFIRMED', valueCents: 10000 },
    payB: { status: 'PENDING', valueCents: 5000 },
    payC: { status: 'CONFIRMED', valueCents: 6999 },
    payOld: { status: 'CONFIRMED', valueCents: 100 },
  };
  const extra = [{ id: 'payGhost', status: 'CONFIRMED', valueCents: 1 }]; // só no Asaas → divergência

  it('hourly: reconcilia via evento sintético no mesmo pipeline; diverge com alerta+métrica', async () => {
    const db = makeFakeDb(pendings);
    const queue = new InMemoryWebhookQueue();
    const metrics = makeMetrics();
    const svc = new BillingReconciliationService(db, queue, makeAsaas(remote, extra)).withMetrics(
      metrics,
    );
    const out = await svc.runOnce({ now: NOW, windowDays: HOURLY_WINDOW_DAYS });
    expect(out.windowDays).toBe(7);
    expect(out.checked).toBe(3); // payOld fora da janela
    expect(out.reconciled).toBe(1);
    expect(out.diverged).toBe(2); // payC valor + payGhost remoto-only
    expect(out.remoteOnly).toBe(1);
    const reconJobs = queue.added.filter((a) => a.data.kind === 'reconciliation');
    expect(reconJobs).toHaveLength(1);
    expect(reconJobs[0].data.eventId).toBe('recon:payA:2026-10-10');
    expect(reconJobs[0].opts).toMatchObject({ jobId: 'recon:payA:2026-10-10' }); // jobId = eventId
    const names = metrics.calls.map((c) => c.n);
    expect(names).toContain('billing.recon.checked');
    expect(names).toContain('billing.recon.completed');
    expect(names).toContain('billing.recon.diverged');
  });

  it('daily 30d inclui o antigo', async () => {
    const db = makeFakeDb(pendings);
    const queue = new InMemoryWebhookQueue();
    const svc = new BillingReconciliationService(db, queue, makeAsaas(remote, [])).withMetrics(
      makeMetrics(),
    );
    const out = await svc.runOnce({ now: NOW, windowDays: DAILY_WINDOW_DAYS });
    expect(out.windowDays).toBe(30);
    expect(out.checked).toBe(4);
    expect(out.reconciled).toBe(2); // payA + payOld
  });
});

describe('BillingReconciliationCron', () => {
  it('runHourly usa 7d; runDaily usa 30d', async () => {
    const seen: number[] = [];
    const svc = {
      runOnce: async (o: { windowDays?: number }) => (
        seen.push(o.windowDays ?? 0),
        { windowDays: o.windowDays }
      ),
    } as unknown as BillingReconciliationService;
    const cron = new BillingReconciliationCron(svc);
    await cron.runHourly(NOW);
    await cron.runDaily(NOW);
    expect(seen).toEqual([7, 30]);
  });
  it('msUntilNextDaily3hSP sempre em (0, 24h]', () => {
    for (const iso of [
      '2026-10-10T05:00:00Z',
      '2026-10-10T06:00:00Z',
      '2026-10-10T02:59:00Z',
      '2026-01-15T12:00:00Z',
    ]) {
      const ms = msUntilNextDaily3hSP(new Date(iso));
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(24 * 3600 * 1000);
    }
  });
});
