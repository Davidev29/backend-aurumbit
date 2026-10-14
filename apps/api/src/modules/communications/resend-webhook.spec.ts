import { randomBytes } from 'node:crypto';
import { CommunicationsController } from './communications.controller';
import { EmailService, redactEmailVars, type EmailRow } from './email.service';
import {
  parseResendWebhook,
  resolveDeliveryStatus,
  signResendWebhookPayload,
  verifyResendWebhookSignature,
} from './resend-webhook';

// Pool fake: despacha por prefixo do SQL (sem PG).
function makeFakePool() {
  const queries: string[] = [];
  const state = {
    insertEmailRows: [] as Array<Record<string, unknown>>,
    selectEmailByEvent: null as EmailRow | null,
    selectEmailByResend: null as EmailRow | null,
    insertReceiptRows: [] as Array<Record<string, unknown>>,
  };
  const pool = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      queries.push(sql);
      if (sql.startsWith('INSERT INTO email_messages')) {
        const row = { status: 'QUEUED' };
        state.insertEmailRows.push({ params });
        return { rows: [row] };
      }
      if (sql.startsWith('INSERT INTO webhook_receipts')) {
        const dup = state.insertReceiptRows.some(
          (r) => (r.params as unknown[])[1] === (params as unknown[])[1],
        );
        if (dup) return { rows: [] };
        state.insertReceiptRows.push({ params });
        return { rows: [{ id: 'wr_1' }] };
      }
      if (sql.includes('FROM email_messages WHERE "eventId"')) {
        return { rows: state.selectEmailByEvent ? [state.selectEmailByEvent] : [] };
      }
      if (sql.includes('FROM email_messages WHERE "resendId"')) {
        return { rows: state.selectEmailByResend ? [state.selectEmailByResend] : [] };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
  return { pool, queries, state };
}

function row(partial: Partial<EmailRow>): EmailRow {
  return {
    id: 'em_1',
    eventId: 'evt-1',
    correlationId: null,
    recipientHash: 'h',
    recipientMasked: 'd***@example.com',
    template: 'payment-confirmed',
    templateVersion: 'v1',
    resendId: 're_123',
    status: 'SENT',
    attempts: 1,
    lastError: null,
    ...partial,
  };
}

describe('resend-webhook (assinatura + parse + transições)', () => {
  const secret = `whsec_${randomBytes(32).toString('base64')}`;

  it('assinatura Svix: round-trip válido; adulterado/expirado/ausente → false', () => {
    const id = 'msg_1';
    const ts = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({ type: 'email.bounced' });
    const sig = signResendWebhookPayload(secret, id, ts, payload);
    const headers = { 'svix-id': id, 'svix-signature': sig, 'svix-timestamp': ts };
    expect(verifyResendWebhookSignature({ secret, payload, headers })).toBe(true);
    expect(verifyResendWebhookSignature({ secret, payload: `${payload} `, headers })).toBe(false);
    const oldTs = String(Math.floor(Date.now() / 1000) - 3600);
    const oldSig = signResendWebhookPayload(secret, id, oldTs, payload);
    expect(
      verifyResendWebhookSignature({ secret, payload, headers: { ...headers, 'svix-timestamp': oldTs, 'svix-signature': oldSig } }),
    ).toBe(false);
    expect(verifyResendWebhookSignature({ secret, payload, headers: {} })).toBe(false);
  });

  it('parse: bounced/complained/delivered mapeiam; opened só dá ack', () => {
    const b = parseResendWebhook({ id: 'w1', type: 'email.bounced', data: { email_id: 're_1' } });
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.event.delivery).toBe('BOUNCED');
      expect(b.event.emailId).toBe('re_1');
    }
    const c = parseResendWebhook({ id: 'w2', type: 'email.complained', data: { email_id: 're_1' } });
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.event.delivery).toBe('COMPLAINED');
    const d = parseResendWebhook({ id: 'w3', type: 'email.delivered', data: { email_id: 're_1' } });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.event.delivery).toBe('DELIVERED');
    expect(resolveDeliveryStatus('email.opened')).toBeNull();
    const bad = parseResendWebhook({ type: 'email.bounced', data: {} });
    expect(bad.ok).toBe(false);
  });

  it('redactEmailVars redige segredos antes de persistir', () => {
    expect(redactEmailVars({ code: '482916', token: 'abc', actionUrl: 'https://x', expiresInMinutes: 10 })).toEqual({
      code: '[REDACTED]',
      token: '[REDACTED]',
      actionUrl: 'https://x',
      expiresInMinutes: 10,
    });
  });

  it('requestEmail: insert → true; conflito → false com status existente (sem reenvio)', async () => {
    const { pool } = makeFakePool();
    const svc = new EmailService(pool as unknown as import('pg').Pool);
    const first = await svc.requestEmail({
      eventId: 'evt-abc-123',
      to: 'User@Example.com',
      template: 'verify-email',
      vars: { actionUrl: 'https://x', expiresInMinutes: 30 },
    });
    expect(first).toEqual({ inserted: true, status: 'QUEUED' });
    const insertSql = (pool.query as jest.Mock).mock.calls[0][0] as string;
    expect(insertSql).toContain('ON CONFLICT ("eventId") DO NOTHING');
    const sentParams = (pool.query as jest.Mock).mock.calls[0][1] as unknown[];
    expect(sentParams).not.toContain('User@Example.com'); // cru nunca persiste
  });

  it('applyResendStatus nunca regride terminal (SENT não sobrescreve BOUNCED)', async () => {
    const { pool, queries, state } = makeFakePool();
    const svc = new EmailService(pool as unknown as import('pg').Pool);
    state.selectEmailByResend = row({ status: 'BOUNCED' });
    const noRegress = await svc.applyResendStatus('re_123', 'SENT');
    expect(noRegress).toEqual({ found: true, updated: false, previous: 'BOUNCED' });
    expect(queries.some((q) => q.startsWith('UPDATE email_messages'))).toBe(false);

    state.selectEmailByResend = row({ status: 'SENT' });
    const bounce = await svc.applyResendStatus('re_123', 'BOUNCED');
    expect(bounce.updated).toBe(true);
    expect(queries.some((q) => q.startsWith('UPDATE email_messages'))).toBe(true);

    state.selectEmailByResend = null;
    expect(await svc.applyResendStatus('re_zzz', 'BOUNCED')).toEqual({ found: false, updated: false });
  });
});

describe('CommunicationsController POST /webhooks/resend', () => {
  const body = { id: 'w-hook-1', type: 'email.bounced', data: { email_id: 're_123' } };

  function controllerWith(stubs: Partial<EmailService>) {
    const svc = { recordWebhookReceipt: jest.fn(), applyResendStatus: jest.fn(), ...stubs };
    return { controller: new CommunicationsController(svc as unknown as EmailService), svc };
  }

  it('aplica BOUNCED e retorna 200; replay do webhook → duplicate', async () => {
    const { controller, svc } = controllerWith({
      recordWebhookReceipt: jest.fn().mockResolvedValue({ inserted: true }),
      applyResendStatus: jest.fn().mockResolvedValue({ found: true, updated: true, previous: 'SENT' }),
    });
    delete process.env.RESEND_WEBHOOK_SECRET;
    const req = { headers: {} } as unknown as import('express').Request;
    const res = await controller.handleResendWebhook(req, body);
    expect(res).toMatchObject({ ok: true, status: 'BOUNCED', updated: true });
    expect(svc.applyResendStatus).toHaveBeenCalledWith('re_123', 'BOUNCED');

    const dup = controllerWith({
      recordWebhookReceipt: jest.fn().mockResolvedValue({ inserted: false }),
      applyResendStatus: jest.fn(),
    });
    const res2 = await dup.controller.handleResendWebhook(req, body);
    expect(res2).toEqual({ ok: true, duplicate: true, type: 'email.bounced' });
    expect(dup.svc.applyResendStatus).not.toHaveBeenCalled();
  });

  it('tipo sem efeito (opened) → 200 ignored sem tocar no DB', async () => {
    const { controller, svc } = controllerWith({});
    delete process.env.RESEND_WEBHOOK_SECRET;
    const req = { headers: {} } as unknown as import('express').Request;
    const res = await controller.handleResendWebhook(req, { id: 'w2', type: 'email.opened', data: {} });
    expect(res).toEqual({ ok: true, ignored: true, type: 'email.opened' });
    expect(svc.recordWebhookReceipt).not.toHaveBeenCalled();
  });

  it('com segredo configurado, assinatura inválida → 401', async () => {
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${randomBytes(32).toString('base64')}`;
    const { controller } = controllerWith({});
    const req = { headers: {} } as unknown as import('express').Request;
    await expect(controller.handleResendWebhook(req, body)).rejects.toMatchObject({ status: 401 });
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  it('com segredo configurado e assinatura válida (rawBody) → 200 applied', async () => {
    const secret = `whsec_${randomBytes(32).toString('base64')}`;
    process.env.RESEND_WEBHOOK_SECRET = secret;
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signResendWebhookPayload(secret, 'msg_9', ts, raw);
    const { controller } = controllerWith({
      recordWebhookReceipt: jest.fn().mockResolvedValue({ inserted: true }),
      applyResendStatus: jest.fn().mockResolvedValue({ found: true, updated: true, previous: 'SENT' }),
    });
    const req = {
      headers: { 'svix-id': 'msg_9', 'svix-signature': sig, 'svix-timestamp': ts },
      rawBody: raw,
    } as unknown as import('express').Request;
    const res = await controller.handleResendWebhook(req, JSON.parse(raw));
    expect(res).toMatchObject({ ok: true, status: 'BOUNCED' });
    delete process.env.RESEND_WEBHOOK_SECRET;
  });
});
