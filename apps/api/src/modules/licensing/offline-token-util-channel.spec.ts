import {
  LIFETIME_SENTINEL_MS,
  mintOfflineToken,
  offlineChannelAllows,
  parseOfflineToken,
} from './offline-token.util';

// Fase 8 — channel no token HMAC legado (flow in-memory). Puro, sem I/O.

describe('offline-token.util channel (Fase 8)', () => {
  it('mint carrega ch; ausente no parse antigo → BOTH (compat)', () => {
    const { token, offExpMs } = mintOfflineToken({
      licenseId: 'lic-1',
      tokenVersion: 1,
      iatMs: Date.parse('2026-10-14T12:00:00.000Z'),
      expiresAtMs: null, // lifetime
      graceUntilMs: null,
      channels: ['DESKTOP'],
    });
    const p = parseOfflineToken(token);
    expect(p.ch).toEqual(['DESKTOP']);
    expect(p.exp).toBe(LIFETIME_SENTINEL_MS);
    expect(offExpMs).toBe(Date.parse('2026-10-14T12:00:00.000Z') + 7 * 24 * 3600 * 1000);
    expect(offlineChannelAllows(p, 'DESKTOP')).toBe(true);
    expect(offlineChannelAllows(p, 'WEB')).toBe(false);
  });
  it('BOTH atende tudo; default sem channels = BOTH', () => {
    const { token } = mintOfflineToken({
      licenseId: 'lic-1',
      tokenVersion: 1,
      iatMs: Date.parse('2026-10-14T12:00:00.000Z'),
      expiresAtMs: Date.parse('2026-11-14T12:00:00.000Z'),
      graceUntilMs: Date.parse('2026-11-17T12:00:00.000Z'),
    });
    const p = parseOfflineToken(token);
    expect(p.ch).toEqual(['BOTH']);
    expect(offlineChannelAllows(p, 'WEB')).toBe(true);
    expect(offlineChannelAllows(p, 'DESKTOP')).toBe(true);
  });
  it('ch presente e malformado com assinatura válida → INVALID (fail-closed)', () => {
    const OLD = process.env.OFFLINE_TOKEN_SECRET;
    process.env.OFFLINE_TOKEN_SECRET = 'test-only-util-secret-min-16';
    try {
      const { createHmac } = require('node:crypto') as typeof import('node:crypto');
      const { token } = mintOfflineToken({
        licenseId: 'lic-1',
        tokenVersion: 1,
        iatMs: Date.parse('2026-10-14T12:00:00.000Z'),
        expiresAtMs: Date.parse('2026-11-14T12:00:00.000Z'),
        graceUntilMs: Date.parse('2026-11-17T12:00:00.000Z'),
        channels: ['DESKTOP'],
      });
      const [body] = token.split('.');
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
      payload.ch = [];
      const forgedBody = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = createHmac('sha256', 'test-only-util-secret-min-16')
        .update(forgedBody, 'utf8')
        .digest('base64url');
      expect(() => parseOfflineToken(`${forgedBody}.${sig}`)).toThrow('INVALID_TOKEN');
    } finally {
      if (OLD === undefined) delete process.env.OFFLINE_TOKEN_SECRET;
      else process.env.OFFLINE_TOKEN_SECRET = OLD;
    }
  });
});
