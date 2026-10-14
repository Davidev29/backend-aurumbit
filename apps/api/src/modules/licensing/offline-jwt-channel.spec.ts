import { mintOfflineToken, validateOfflineToken } from './offline-jwt';

// Fase 8 — channel no offline JWT (path PG). Puro, sem I/O.

const SECRET = 'test-only-channel-secret-min-16-chars';

function mint(over: Record<string, unknown> = {}) {
  return mintOfflineToken(
    {
      iss: 'aurum-bit',
      licenseId: 'lic-1',
      ownerId: 'cust-1',
      productId: 'prod-1',
      features: ['DESKTOP_APP'],
      deviceHash: 'dev-1',
      expiresAt: null, // lifetime
      graceUntil: null,
      tokenVersion: 1,
      ...over,
    } as never,
    SECRET,
  );
}

describe('offline JWT channel (Fase 8)', () => {
  it('mint carrega ch; validate com canal certo → ALLOW LIFETIME', () => {
    const { token, claims } = mint({ channels: ['DESKTOP'] });
    expect(claims.ch).toEqual(['DESKTOP']);
    const v = validateOfflineToken(token, { secret: SECRET, expectedChannel: 'DESKTOP' });
    expect(v).toMatchObject({ verdict: 'ALLOW', reason: 'LIFETIME' });
  });
  it('canal errado → DENY CHANNEL_MISMATCH', () => {
    const { token } = mint({ channels: ['DESKTOP'] });
    expect(validateOfflineToken(token, { secret: SECRET, expectedChannel: 'WEB' })).toMatchObject({
      verdict: 'DENY',
      reason: 'CHANNEL_MISMATCH',
    });
  });
  it('BOTH atende qualquer canal; sem ch (legado) = BOTH', () => {
    const { token } = mint();
    expect(validateOfflineToken(token, { secret: SECRET, expectedChannel: 'WEB' })).toMatchObject({
      verdict: 'ALLOW',
    });
    expect(validateOfflineToken(token, { secret: SECRET, expectedChannel: 'DESKTOP' })).toMatchObject({
      verdict: 'ALLOW',
    });
  });
  it('sem expectedChannel = sem gating (legado)', () => {
    const { token } = mint({ channels: ['DESKTOP'] });
    expect(validateOfflineToken(token, { secret: SECRET })).toMatchObject({ verdict: 'ALLOW' });
  });
  it('adulterar ch quebra a assinatura', () => {
    const { token } = mint({ channels: ['DESKTOP'] });
    const [h, b, s] = token.split('.');
    const body = JSON.parse(Buffer.from(b, 'base64url').toString('utf8')) as { ch: string[] };
    body.ch = ['WEB', 'DESKTOP', 'BOTH'];
    const forged = `${h}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${s}`;
    expect(validateOfflineToken(forged, { secret: SECRET, expectedChannel: 'WEB' })).toMatchObject({
      verdict: 'DENY',
      reason: 'INVALID_SIGNATURE',
    });
  });
});
