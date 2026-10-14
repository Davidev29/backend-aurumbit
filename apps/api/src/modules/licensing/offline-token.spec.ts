// Matriz offline (PROJECT.md §1) sobre a lib pura — usada pelo app e pelos testes.
// lic_exp=2026-11-10, grace_until=2026-11-13. off_exp = min(iat+7d, lic_exp+7d).
import {
  mintOfflineToken,
  validateOfflineToken,
  type MintInput,
} from './offline-jwt';

const SECRET = 'test-only-offline-secret-min-16-chars';
const DEV = 'a'.repeat(64);

function mintAt(iat: string, over: Partial<MintInput> = {}) {
  const base: MintInput = {
    iss: 'aurum-bit',
    licenseId: 'lic-1',
    ownerId: 'cust-1',
    productId: 'prod-1',
    features: ['F1'],
    deviceHash: DEV,
    expiresAt: new Date('2026-11-10T00:00:00.000Z'),
    graceUntil: new Date('2026-11-13T00:00:00.000Z'),
    tokenVersion: 1,
    issuedAt: new Date(iat),
  };
  return mintOfflineToken({ ...base, ...over }, SECRET);
}

const V = (token: string, now: string, extra: Record<string, unknown> = {}) =>
  validateOfflineToken(token, { secret: SECRET, expectedIss: 'aurum-bit', now: new Date(now), ...extra });

describe('offline-token — off_exp = min(iat+7d, lic_exp+7d)', () => {
  it('teto pelo iat quando a validade é longa', () => {
    const { claims } = mintAt('2026-11-01T00:00:00.000Z');
    expect(new Date(claims.off_exp * 1000).toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });

  it('teto pela expiração (nunca estende além de +7d da validade)', () => {
    const { claims } = mintAt('2026-11-09T00:00:00.000Z'); // iat+7d=11-16, exp+7d=11-17
    expect(new Date(claims.off_exp * 1000).toISOString()).toBe('2026-11-16T00:00:00.000Z');
    const late = mintAt('2026-11-12T00:00:00.000Z', {
      expiresAt: new Date('2026-11-10T00:00:00.000Z'),
    }); // iat+7d=11-19, exp+7d=11-17
    expect(new Date(late.claims.off_exp * 1000).toISOString()).toBe('2026-11-17T00:00:00.000Z');
  });
});

describe('offline-token — matriz PROJECT.md §1', () => {
  const { token } = mintAt('2026-11-01T00:00:00.000Z'); // off_exp 11-08

  it('antes da expiração e do teto → ALLOW', () => {
    expect(V(token, '2026-11-05T00:00:00.000Z')).toMatchObject({
      verdict: 'ALLOW',
      degraded: false,
      reason: 'ACTIVE',
    });
  });

  it('durante a graça (lic_exp < now <= grace, off ok) → ALLOW degradado', () => {
    const grace = mintAt('2026-11-05T00:00:00.000Z'); // off_exp 11-12 cobre a graça
    expect(V(grace.token, '2026-11-11T00:00:00.000Z')).toMatchObject({
      verdict: 'ALLOW',
      degraded: true,
      reason: 'GRACE',
    });
  });

  it('após a graça → DENY EXPIRED mesmo com off_exp válido', () => {
    const grace = mintAt('2026-11-12T00:00:00.000Z'); // off_exp 11-17 (válido em 11-14)
    expect(V(grace.token, '2026-11-14T00:00:00.000Z')).toEqual({
      verdict: 'DENY',
      reason: 'EXPIRED',
      detail: 'além de grace_until',
    });
  });

  it('após off_exp (ainda vigente) → DENY OFFLINE_EXPIRED, exige online', () => {
    const long = mintAt('2026-11-01T00:00:00.000Z', {
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      graceUntil: new Date('2026-12-04T00:00:00.000Z'),
    });
    expect(V(long.token, '2026-11-09T00:00:00.000Z')).toEqual({
      verdict: 'DENY',
      reason: 'OFFLINE_EXPIRED',
      detail: 'teto 7d offline excedido',
    });
  });
});

describe('offline-token — amarras (DENY)', () => {
  const { token } = mintAt('2026-11-01T00:00:00.000Z');

  it('assinatura inválida → INVALID_SIGNATURE', () => {
    const bad = token.slice(0, -2) + 'xx';
    expect(validateOfflineToken(bad, { secret: SECRET, now: new Date('2026-11-05T00:00:00Z') })).toMatchObject({
      verdict: 'DENY',
      reason: 'INVALID_SIGNATURE',
    });
  });

  it('clone suspeito marcado no backend → CLONE_SUSPECT', () => {
    expect(V(token, '2026-11-05T00:00:00.000Z', { clonedSuspect: true })).toMatchObject({
      verdict: 'DENY',
      reason: 'CLONE_SUSPECT',
    });
  });

  it('device bloqueado → DEVICE_BLOCKED', () => {
    expect(V(token, '2026-11-05T00:00:00.000Z', { deviceStatus: 'blocked' })).toMatchObject({
      verdict: 'DENY',
      reason: 'DEVICE_BLOCKED',
    });
  });

  it('token_version divergente (revogado) → TOKEN_STALE', () => {
    expect(V(token, '2026-11-05T00:00:00.000Z', { expectedTv: 2 })).toMatchObject({
      verdict: 'DENY',
      reason: 'TOKEN_STALE',
    });
  });

  it('device divergente → DEVICE_MISMATCH', () => {
    expect(V(token, '2026-11-05T00:00:00.000Z', { expectedDev: 'b'.repeat(64) })).toMatchObject({
      verdict: 'DENY',
      reason: 'DEVICE_MISMATCH',
    });
  });

  it('iat futuro → CLONE_SUSPECT', () => {
    const future = mintAt('2026-11-05T00:00:00.000Z');
    expect(V(future.token, '2026-11-01T00:00:00.000Z')).toMatchObject({
      verdict: 'DENY',
      reason: 'CLONE_SUSPECT',
    });
  });

  it('contador com rollback → CLONE_SUSPECT; avanço → ALLOW', () => {
    const withCtr = mintAt('2026-11-01T00:00:00.000Z', { tokenVersion: 1 });
    void withCtr;
    const t9 = mintOfflineToken(
      {
        iss: 'aurum-bit',
        licenseId: 'lic-1',
        ownerId: 'cust-1',
        productId: 'prod-1',
        features: ['F1'],
        deviceHash: DEV,
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
        graceUntil: new Date('2026-12-04T00:00:00.000Z'),
        tokenVersion: 1,
        issuedAt: new Date('2026-11-01T00:00:00.000Z'),
        ctr: 9,
      },
      SECRET,
    );
    expect(V(t9.token, '2026-11-05T00:00:00.000Z', { lastCtr: 10 })).toMatchObject({
      verdict: 'DENY',
      reason: 'CLONE_SUSPECT',
    });
    expect(V(t9.token, '2026-11-05T00:00:00.000Z', { lastCtr: 9 })).toMatchObject({ verdict: 'ALLOW' });
  });

  it('vitalícia (lic_exp null) → ALLOW até o teto 7d', () => {
    const life = mintAt('2026-11-01T00:00:00.000Z', { expiresAt: null, graceUntil: null });
    expect(V(life.token, '2026-11-05T00:00:00.000Z')).toMatchObject({ verdict: 'ALLOW', reason: 'LIFETIME' });
    expect(V(life.token, '2026-11-09T00:00:00.000Z')).toMatchObject({
      verdict: 'DENY',
      reason: 'OFFLINE_EXPIRED',
    });
  });
});
