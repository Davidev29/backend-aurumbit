import { randomBytes } from 'node:crypto';

// Exercita o adapter REAL (libs/resend-adapter). O `require` dinâmico (em
// vez de `import` estático, inclusive em posição de tipo) mantém o
// `tsc`/`nest build` fora do arquivo: referência estática violaria o
// `rootDir` da API (TS6059), pois apps/api compila com rootDir próprio e
// nunca importa os pacotes (mesmo padrão do licensing). Em runtime
// (ts-jest) o require carrega o .ts real do adapter.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adapter = require('../../../../../libs/resend-adapter/src/index') as {
  ResendClient: new (opts: {
    apiKey: string;
    from: string;
    baseUrl?: string;
    fetchImpl?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
      ok: boolean;
      status: number;
      json(): Promise<unknown>;
      text(): Promise<string>;
    }>;
  }) => {
    send(input: {
      to: string;
      subject: string;
      html: string;
      text?: string;
      idempotencyKey: string;
    }): Promise<{ resendId: string }>;
  };
  ResendError: { name: string };
  maskEmail(email: string): string;
  normalizeEmail(email: string): string;
  sha256Hex(input: string): string;
  redactEmailVars(vars: Record<string, unknown>): Record<string, unknown>;
  parseResendWebhook(body: unknown):
    | { ok: true; event: { webhookId: string; type: string; emailId?: string; delivery: string | null } }
    | { ok: false; errors: string[] };
  resolveDeliveryStatus(type: string): string | null;
  signResendWebhookPayload(secret: string, id: string, timestamp: string, payload: string): string;
  verifyResendWebhookSignature(opts: {
    secret: string;
    payload: string;
    headers: Record<string, string | undefined>;
  }): boolean;
};

const {
  ResendClient,
  ResendError,
  maskEmail,
  normalizeEmail,
  parseResendWebhook,
  redactEmailVars,
  resolveDeliveryStatus,
  sha256Hex,
  signResendWebhookPayload,
  verifyResendWebhookSignature,
} = adapter;

function stubFetch(handler: (url: string, init: { headers: Record<string, string>; body: string }) => unknown) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return handler(url, init) as {
      ok: boolean;
      status: number;
      json(): Promise<unknown>;
      text(): Promise<string>;
    };
  };
  return { fetchImpl, calls };
}

const okFetch = (id = 're_abc123') =>
  stubFetch(() => ({ ok: true, status: 200, json: async () => ({ id }), text: async () => '' }));

describe('resend-adapter (libs/resend-adapter)', () => {
  const input = {
    to: 'cliente@example.com',
    subject: 'Oi',
    html: '<p>Oi</p>',
    text: 'Oi',
    idempotencyKey: 'evt-abc-12345',
  };

  it('envia com Idempotency-Key=eventId e retorna o resendId', async () => {
    const { fetchImpl, calls } = okFetch();
    const client = new ResendClient({ apiKey: 're_test', from: 'Aurum <no-reply@example.com>', fetchImpl });
    const out = await client.send(input);
    expect(out).toEqual({ resendId: 're_abc123' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].headers['Idempotency-Key']).toBe('evt-abc-12345');
    expect(calls[0].headers.Authorization).toBe('Bearer re_test');
    expect(calls[0].body).toMatchObject({ to: ['cliente@example.com'], subject: 'Oi' });
  });

  it('429/5xx → retryable; 400 → poison; rede → retryable', async () => {
    const r429 = stubFetch(() => ({ ok: false, status: 429, json: async () => ({}), text: async () => 'rate' }));
    const c429 = new ResendClient({ apiKey: 'k', from: 'f@x.com', fetchImpl: r429.fetchImpl });
    await expect(c429.send(input)).rejects.toMatchObject({ name: 'ResendError', retryable: true, status: 429 });

    const r400 = stubFetch(() => ({ ok: false, status: 400, json: async () => ({}), text: async () => 'bad' }));
    const c400 = new ResendClient({ apiKey: 'k', from: 'f@x.com', fetchImpl: r400.fetchImpl });
    await expect(c400.send(input)).rejects.toMatchObject({ retryable: false, status: 400 });

    const cNet = new ResendClient({
      apiKey: 'k',
      from: 'f@x.com',
      fetchImpl: async () => {
        throw new Error('socket hang up');
      },
    });
    await expect(cNet.send(input)).rejects.toMatchObject({ retryable: true });
    expect(ResendError.name).toBe('ResendError');
  });

  it('valida entrada sem chamar a rede (idempotencyKey/to obrigatórios)', async () => {
    const { fetchImpl, calls } = okFetch();
    const client = new ResendClient({ apiKey: 'k', from: 'f@x.com', fetchImpl });
    await expect(client.send({ ...input, idempotencyKey: '' })).rejects.toMatchObject({ retryable: false });
    await expect(client.send({ ...input, to: 'nao-email' })).rejects.toMatchObject({ retryable: false });
    expect(calls).toHaveLength(0);
  });

  it('webhook: assina→verifica; resolve bounced/complained/delivered; parse defensivo', () => {
    const secret = `whsec_${randomBytes(32).toString('base64')}`;
    const id = 'msg_adapter_1';
    const ts = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({ id: 'w1', type: 'email.complained', data: { email_id: 're_1' } });
    const sig = signResendWebhookPayload(secret, id, ts, payload);
    expect(verifyResendWebhookSignature({ secret, payload, headers: { 'svix-id': id, 'svix-signature': sig, 'svix-timestamp': ts } })).toBe(true);
    const parsed = parseResendWebhook(JSON.parse(payload));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.event.delivery).toBe('COMPLAINED');
      expect(parsed.event.webhookId).toBe('w1');
    }
    expect(resolveDeliveryStatus('email.bounced')).toBe('BOUNCED');
    expect(resolveDeliveryStatus('email.delivery_delayed')).toBe('BOUNCED');
    expect(resolveDeliveryStatus('email.delivered')).toBe('DELIVERED');
    expect(resolveDeliveryStatus('email.clicked')).toBeNull();
  });

  it('privacidade: hash/máscara/redação (espelha libs/security)', () => {
    expect(normalizeEmail('  USER@Example.com ')).toBe('user@example.com');
    expect(maskEmail('david@example.com')).toBe('d***@example.com');
    expect(sha256Hex('a')).toHaveLength(64);
    expect(redactEmailVars({ code: '123', actionUrl: 'https://x' })).toEqual({
      code: '[REDACTED]',
      actionUrl: 'https://x',
    });
  });
});
