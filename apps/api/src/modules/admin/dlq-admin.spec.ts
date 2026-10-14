import { ForbiddenException } from '@nestjs/common';
import { DlqAdminGuard } from './dlq-admin.guard';
import { InMemoryDlqStore } from './dlq-store';

function ctx(headers: Record<string, unknown>): any {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) };
}

describe('DLQ admin — store (replay idempotente + paginação)', () => {
  it('enqueue idempotente por queue+jobId (duplicata retorna a existente)', () => {
    const store = new InMemoryDlqStore();
    const first = store.enqueue({ queue: 'billing.dlq', jobId: 'evt-1', eventId: 'evt-1', reason: 'boom' });
    expect(first.duplicate).toBe(false);
    const second = store.enqueue({ queue: 'billing.dlq', jobId: 'evt-1', eventId: 'evt-1', reason: 'boom' });
    expect(second.duplicate).toBe(true);
    expect(store.list().total).toBe(1);
  });

  it('list paginado por fila (page/pageSize, mais antigas primeiro)', () => {
    const store = new InMemoryDlqStore();
    for (let i = 0; i < 5; i++) {
      store.enqueue({ queue: 'finance.dlq', jobId: `evt-f-${i}`, eventId: `evt-f-${i}` });
    }
    store.enqueue({ queue: 'billing.dlq', jobId: 'evt-b-0', eventId: 'evt-b-0' });
    const p1 = store.list({ queue: 'finance.dlq', page: 1, pageSize: 2 });
    expect(p1).toMatchObject({ page: 1, pageSize: 2, total: 5 });
    expect(p1.items).toHaveLength(2);
    expect(p1.items[0].jobId).toBe('evt-f-0');
    const p3 = store.list({ queue: 'finance.dlq', page: 3, pageSize: 2 });
    expect(p3.items).toHaveLength(1);
    expect(store.list().total).toBe(6);
  });

  it('replay idempotente: 1ª replaya, 2ª retorna duplicate sem re-enfileirar', () => {
    const store = new InMemoryDlqStore();
    store.enqueue({ queue: 'comm.email.dlq', jobId: 'evt-e-1', eventId: 'evt-e-1', reason: 'smtp 5xx' });
    const first = store.replay('comm.email.dlq', 'evt-e-1');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ duplicate: false, replayCount: 1 });
    const second = store.replay('comm.email.dlq', 'evt-e-1');
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ duplicate: true, replayCount: 1 });
    // Replayado sai da profundidade (não pressiona operação).
    expect(store.depth()).toEqual({});
  });

  it('replay aceita eventId como identificador e normaliza nome da fila', () => {
    const store = new InMemoryDlqStore();
    store.enqueue({ queue: 'billing', jobId: 'dlq:evt-x', eventId: 'evt-x' });
    const out = store.replay('billing.dlq', 'evt-x');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ queue: 'billing.dlq', eventId: 'evt-x', duplicate: false });
  });

  it('replay de jobId inexistente retorna vazio (sem erro, sem duplicar)', () => {
    const store = new InMemoryDlqStore();
    expect(store.replay('finance.dlq', 'evt-fantasma')).toEqual([]);
  });
});

describe('DLQ admin — guard (admin + MFA stub)', () => {
  const guard = new DlqAdminGuard();

  it('403 sem x-role admin', () => {
    expect(() => guard.canActivate(ctx({}))).toThrow(ForbiddenException);
  });

  it('403 admin sem MFA step-up (x-mfa: verified ausente)', () => {
    let code = '';
    try {
      guard.canActivate(ctx({ 'x-role': 'admin' }));
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      const res = (e as ForbiddenException).getResponse() as { code?: string };
      code = typeof res === 'object' && res !== null ? String(res.code ?? '') : '';
    }
    expect(code).toBe('MFA_REQUIRED');
  });

  it('200 admin + MFA stub', () => {
    expect(guard.canActivate(ctx({ 'x-role': 'admin', 'x-mfa': 'verified' }))).toBe(true);
  });
});
