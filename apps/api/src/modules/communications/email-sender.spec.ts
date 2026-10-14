import { SEND_MAX_ATTEMPTS, sendJobOptions } from './comm.queues';
import type { EmailRowStatus } from './email.service';
import {
  handleEmailSendJob,
  type EmailSenderStore,
  type EmailTransport,
} from './email-sender.worker';

// Fakes em memória (sem Redis/PG). O store replica a semântica do SQL:
// upsert por eventId (conflito → linha existente), terminal SENT dispensa envio.

interface MemRow {
  status: EmailRowStatus;
}

function makeStore() {
  const rows = new Map<string, MemRow>();
  const calls = { requestEmail: 0, markSending: 0, markSent: 0, markFailed: 0 };
  const failNextMarkSent = { value: false };
  const store: EmailSenderStore = {
    requestEmail: async (input) => {
      calls.requestEmail += 1;
      const existing = rows.get(input.eventId);
      if (existing) return { inserted: false, status: existing.status };
      rows.set(input.eventId, { status: 'QUEUED' });
      return { inserted: true, status: 'QUEUED' };
    },
    markSending: async (eventId) => {
      calls.markSending += 1;
      const r = rows.get(eventId);
      if (!r) return false;
      if (r.status === 'QUEUED' || r.status === 'FAILED') {
        r.status = 'SENDING';
        return true;
      }
      return false;
    },
    markSent: async (eventId) => {
      calls.markSent += 1;
      if (failNextMarkSent.value) {
        failNextMarkSent.value = false;
        throw new Error('crash simulado entre send e markSent');
      }
      const r = rows.get(eventId);
      if (r) r.status = 'SENT';
    },
    markFailed: async (eventId) => {
      calls.markFailed += 1;
      const r = rows.get(eventId);
      if (r) r.status = 'FAILED';
    },
  };
  return { store, rows, calls, failNextMarkSent };
}

function makeTransport() {
  const sent: Array<{ to: string; idempotencyKey: string }> = [];
  const behavior: { failNext?: { message: string; retryable?: boolean } } = {};
  const transport: EmailTransport = {
    send: async (input) => {
      if (behavior.failNext) {
        const f = behavior.failNext;
        behavior.failNext = undefined;
        const err = new Error(f.message) as Error & { retryable?: boolean };
        if (f.retryable !== undefined) err.retryable = f.retryable;
        throw err;
      }
      sent.push({ to: input.to, idempotencyKey: input.idempotencyKey });
      return { resendId: `re_${sent.length}` };
    },
  };
  return { transport, sent, behavior };
}

function makeDlq() {
  const moved: Array<{ jobId: string; reason: string }> = [];
  return {
    moved,
    moveToDlq: async (jobId: string, _data: unknown, reason: string) => {
      moved.push({ jobId, reason });
    },
  };
}

const BASE_JOB = {
  eventId: 'evt-replay-001',
  to: 'cliente@example.com',
  template: 'payment-confirmed',
  templateVersion: 'v1',
  vars: { referenceCode: 'pay_123', amountCents: 9990, currency: 'BRL' },
};

describe('EmailSenderWorker (idempotência + retry + DLQ)', () => {
  it('envia uma vez com idempotencyKey=eventId', async () => {
    const { store } = makeStore();
    const { transport, sent } = makeTransport();
    const dlq = makeDlq();
    const out = await handleEmailSendJob(
      { id: BASE_JOB.eventId, data: { ...BASE_JOB }, attemptsMade: 0 },
      { store, transport, moveToDlq: dlq.moveToDlq },
    );
    expect(out.status).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0].idempotencyKey).toBe(BASE_JOB.eventId);
    expect(dlq.moved).toHaveLength(0);
  });

  it('replay do mesmo eventId NÃO duplica o envio (duplicate)', async () => {
    const { store } = makeStore();
    const { transport, sent } = makeTransport();
    const dlq = makeDlq();
    const deps = { store, transport, moveToDlq: dlq.moveToDlq };
    const first = await handleEmailSendJob({ id: BASE_JOB.eventId, data: { ...BASE_JOB }, attemptsMade: 0 }, deps);
    expect(first.status).toBe('sent');
    const replay = await handleEmailSendJob({ id: BASE_JOB.eventId, data: { ...BASE_JOB }, attemptsMade: 0 }, deps);
    expect(replay).toEqual({ status: 'duplicate', eventId: BASE_JOB.eventId });
    expect(sent).toHaveLength(1); // nenhum segundo POST ao Resend
  });

  it('crash entre send e markSent: retry usa o mesmo idempotencyKey (2ª camada)', async () => {
    const { store, failNextMarkSent } = makeStore();
    const { transport, sent } = makeTransport();
    const dlq = makeDlq();
    const deps = { store, transport, moveToDlq: dlq.moveToDlq };
    failNextMarkSent.value = true;
    await expect(
      handleEmailSendJob({ id: BASE_JOB.eventId, data: { ...BASE_JOB }, attemptsMade: 0 }, deps),
    ).rejects.toThrow('crash simulado');
    const retry = await handleEmailSendJob({ id: BASE_JOB.eventId, data: { ...BASE_JOB }, attemptsMade: 1 }, deps);
    expect(retry.status).toBe('sent');
    expect(sent.map((s) => s.idempotencyKey)).toEqual([BASE_JOB.eventId, BASE_JOB.eventId]);
  });

  it('falha transitória lança p/ retry; esgotados os attempts → FAILED + DLQ', async () => {
    const { store, rows } = makeStore();
    const { transport, behavior } = makeTransport();
    const dlq = makeDlq();
    const deps = { store, transport, moveToDlq: dlq.moveToDlq };
    behavior.failNext = { message: 'resend 503' };
    await expect(
      handleEmailSendJob({ id: BASE_JOB.eventId, data: { ...BASE_JOB }, attemptsMade: 0 }, deps),
    ).rejects.toThrow('resend 503');
    behavior.failNext = { message: 'resend 503' };
    const last = await handleEmailSendJob(
      { id: BASE_JOB.eventId, data: { ...BASE_JOB }, attemptsMade: SEND_MAX_ATTEMPTS - 1 },
      deps,
    );
    expect(last).toEqual({ status: 'dlq', eventId: BASE_JOB.eventId });
    expect(rows.get(BASE_JOB.eventId)?.status).toBe('FAILED');
    expect(dlq.moved).toHaveLength(1);
    expect(dlq.moved[0].jobId).toBe(`dlq:${BASE_JOB.eventId}`);
  });

  it('erro não-retryable vai direto p/ DLQ (sem esgotar attempts)', async () => {
    const { store } = makeStore();
    const { transport, behavior, sent } = makeTransport();
    const dlq = makeDlq();
    behavior.failNext = { message: 'resend 400 invalid', retryable: false };
    const out = await handleEmailSendJob(
      { id: BASE_JOB.eventId, data: { ...BASE_JOB }, attemptsMade: 0 },
      { store, transport, moveToDlq: dlq.moveToDlq },
    );
    expect(out.status).toBe('dlq');
    expect(sent).toHaveLength(0);
    expect(dlq.moved).toHaveLength(1);
  });

  it('payload inválido vai direto p/ DLQ sem tocar no transporte', async () => {
    const { store, calls } = makeStore();
    const { transport, sent } = makeTransport();
    const dlq = makeDlq();
    const out = await handleEmailSendJob(
      { id: 'x', data: { template: 'payment-confirmed' }, attemptsMade: 0 },
      { store, transport, moveToDlq: dlq.moveToDlq },
    );
    expect(out.status).toBe('dlq');
    expect(sent).toHaveLength(0);
    expect(calls.requestEmail).toBe(0);
    expect(dlq.moved).toHaveLength(1);
  });

  it('template fora de escopo (deposit-confirmed) vai p/ DLQ sem enviar', async () => {
    const { store, calls } = makeStore();
    const { transport, sent } = makeTransport();
    const dlq = makeDlq();
    const out = await handleEmailSendJob(
      {
        id: 'evt-fora-escopo',
        data: { eventId: 'evt-fora-escopo', to: 'a@example.com', template: 'deposit-confirmed', vars: {} },
        attemptsMade: 0,
      },
      { store, transport, moveToDlq: dlq.moveToDlq },
    );
    expect(out).toEqual({ status: 'dlq', eventId: 'evt-fora-escopo' });
    expect(sent).toHaveLength(0);
    expect(calls.requestEmail).toBe(0);
    expect(dlq.moved[0].reason).toContain('fora de escopo');
  });

  it('sendJobOptions usa jobId=eventId com 5 tentativas exponenciais', () => {
    const opts = sendJobOptions('evt-abc-123');
    expect(opts.jobId).toBe('evt-abc-123');
    expect(opts.attempts).toBe(SEND_MAX_ATTEMPTS);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: expect.any(Number) });
  });
});
