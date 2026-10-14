import { EntitlementCandidate, evaluateCheck } from './access-policy';

const NOW = new Date('2026-10-10T12:00:00.000Z');

function ent(over: Partial<EntitlementCandidate> = {}): EntitlementCandidate {
  return {
    id: 'ent-1',
    ownerType: 'CUSTOMER',
    ownerId: 'cust-1',
    productId: 'prod-1',
    featureCode: 'F1',
    origin: 'CONTRACT',
    originId: 'c-1',
    priority: 10,
    status: 'ACTIVE',
    quotaValue: null,
    startsAt: null,
    expiresAt: null,
    graceUntil: null,
    ...over,
  };
}

describe('evaluateCheck (PROJECT.md §1)', () => {
  it('permite dentro da vigência', () => {
    const d = evaluateCheck(
      [ent({ expiresAt: new Date('2026-11-10T12:00:00Z'), graceUntil: new Date('2026-11-13T12:00:00Z') })],
      NOW,
    );
    expect(d).toMatchObject({ allow: true, degraded: false, reason: 'ACTIVE' });
  });

  it('permite degradado em grace (expires < now <= grace)', () => {
    const d = evaluateCheck(
      [ent({ expiresAt: new Date('2026-10-09T12:00:00Z'), graceUntil: new Date('2026-10-12T12:00:00Z') })],
      NOW,
    );
    expect(d).toMatchObject({ allow: true, degraded: true, reason: 'GRACE' });
  });

  it('nega após a graça', () => {
    const d = evaluateCheck(
      [ent({ expiresAt: new Date('2026-10-01T12:00:00Z'), graceUntil: new Date('2026-10-04T12:00:00Z') })],
      NOW,
    );
    expect(d).toEqual({ allow: false, degraded: false, reason: 'EXPIRED' });
  });

  it('nega expirado sem janela de graça', () => {
    const d = evaluateCheck([ent({ expiresAt: new Date('2026-10-01T12:00:00Z') })], NOW);
    expect(d).toEqual({ allow: false, degraded: false, reason: 'EXPIRED' });
  });

  it('permite vitalícia (expires null)', () => {
    const d = evaluateCheck([ent({ origin: 'BONUS', priority: 5 })], NOW);
    expect(d).toMatchObject({ allow: true, degraded: false, reason: 'LIFETIME' });
  });

  it('maior priority vence (LICENSE 30 > BONUS 5 expirado)', () => {
    const d = evaluateCheck(
      [
        ent({ id: 'bonus', origin: 'BONUS', priority: 5, expiresAt: new Date('2026-09-01T12:00:00Z') }),
        ent({ id: 'lic', origin: 'LICENSE', originId: 'l-1', priority: 30, expiresAt: new Date('2027-01-01T12:00:00Z') }),
      ],
      NOW,
    );
    expect(d).toMatchObject({ allow: true, entitlementId: 'lic', priority: 30 });
  });

  it('REVOKED nunca autoriza', () => {
    const d = evaluateCheck([ent({ status: 'REVOKED' })], NOW);
    expect(d).toEqual({ allow: false, degraded: false, reason: 'REVOKED' });
  });

  it('SUSPENDED nega mesmo vigente', () => {
    const d = evaluateCheck(
      [ent({ status: 'SUSPENDED', expiresAt: new Date('2027-01-01T12:00:00Z') })],
      NOW,
    );
    expect(d).toEqual({ allow: false, degraded: false, reason: 'SUSPENDED' });
  });

  it('sem entitlement → NOT_FOUND', () => {
    expect(evaluateCheck([], NOW)).toEqual({ allow: false, degraded: false, reason: 'NOT_FOUND' });
  });
});

describe('evaluateCheck por canal (Fase 8)', () => {
  const F = (over: Partial<EntitlementCandidate> = {}) =>
    ent({ expiresAt: new Date('2027-01-01T12:00:00Z'), ...over });
  it('BOTH atende WEB e DESKTOP', () => {
    expect(evaluateCheck([F({ channel: 'BOTH' })], NOW, 'WEB')).toMatchObject({ allow: true });
    expect(evaluateCheck([F({ channel: 'BOTH' })], NOW, 'DESKTOP')).toMatchObject({ allow: true });
  });
  it('canal exato autoriza; canal alheio nega CHANNEL_MISMATCH', () => {
    expect(evaluateCheck([F({ channel: 'DESKTOP' })], NOW, 'DESKTOP')).toMatchObject({ allow: true });
    expect(evaluateCheck([F({ channel: 'DESKTOP' })], NOW, 'WEB')).toEqual({
      allow: false,
      degraded: false,
      reason: 'CHANNEL_MISMATCH',
    });
  });
  it('ausente no legado = BOTH (compat)', () => {
    const { channel: _drop, ...legacy } = F();
    expect(evaluateCheck([legacy as EntitlementCandidate], NOW, 'WEB')).toMatchObject({ allow: true });
  });
  it('sem canal requisitado = sem gating (legado)', () => {
    expect(evaluateCheck([F({ channel: 'DESKTOP' })], NOW)).toMatchObject({ allow: true });
  });
  it('prioridade vale dentro do canal (LICENSE 30 > SUBSCRIPTION 20)', () => {
    const d = evaluateCheck(
      [
        F({ id: 'sub', origin: 'SUBSCRIPTION', originId: 's-1', priority: 20, channel: 'WEB' }),
        F({ id: 'lic', origin: 'LICENSE', originId: 'l-1', priority: 30, channel: 'BOTH' }),
      ],
      NOW,
      'WEB',
    );
    expect(d).toMatchObject({ allow: true, entitlementId: 'lic', priority: 30 });
  });
});
