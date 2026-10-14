import {
  LicenseKind,
  calcExpiry,
  effectiveStatus,
  kindForBillingInterval,
} from './license-keys';
import { normalizeFeatureSnapshot, snapshotFromRow } from './licenses.service';

// Fase 8 — modelo comercial (lifetime + mapeamento de intervalo + snapshot).
// Puras, sem I/O (mesmo padrão de license-keys.spec.ts).

describe('calcExpiry lifetime (ONE_TIME → perpétua)', () => {
  it('lifetime não expira: expires/grace null', () => {
    const start = new Date('2026-10-14T12:00:00.000Z');
    expect(calcExpiry(start, 'lifetime')).toEqual({ expiresAt: null, graceUntil: null });
  });
  it('lifetime é active para sempre (effectiveStatus)', () => {
    expect(
      effectiveStatus({ status: 'active', expiresAt: null, graceUntil: null }, new Date('2036-01-01T00:00:00Z')),
    ).toBe('active');
  });
  it('monthly/annual preservados', () => {
    const start = new Date('2026-10-14T12:00:00.000Z');
    const m = calcExpiry(start, 'monthly');
    expect(m.expiresAt?.toISOString()).toBe('2026-11-14T12:00:00.000Z');
    expect(m.graceUntil?.toISOString()).toBe('2026-11-17T12:00:00.000Z');
    const a = calcExpiry(start, 'annual');
    expect(a.expiresAt?.toISOString()).toBe('2027-10-14T12:00:00.000Z');
  });
  it('kind inválido falha fechado', () => {
    expect(() => calcExpiry(new Date(), 'semanal' as LicenseKind)).toThrow('kind inválido');
  });
});

describe('kindForBillingInterval', () => {
  it.each([
    ['MONTH', 'monthly'],
    ['YEAR', 'annual'],
    ['ONE_TIME', 'lifetime'],
  ])('%s → %s', (interval, kind) => {
    expect(kindForBillingInterval(interval)).toBe(kind);
  });
  it('desconhecido falha fechado (nunca adivinhar vigência)', () => {
    expect(() => kindForBillingInterval('WEEK')).toThrow('intervalo inválido');
    expect(() => kindForBillingInterval('month')).toThrow('intervalo inválido');
  });
});

describe('normalizeFeatureSnapshot', () => {
  it('canoniza channel, dedup por code, BOTH em valor estranho', () => {
    expect(
      normalizeFeatureSnapshot([
        { code: 'WEB_ACCESS', channel: 'WEB' },
        { code: 'DESKTOP_APP', channel: 'DESKTOP' },
        { code: 'OFFLINE' },
        { code: 'WEB_ACCESS', channel: 'DESKTOP' },
        { code: 'X', channel: 'MOBILE' },
        { code: '  ' },
      ]),
    ).toEqual([
      { code: 'WEB_ACCESS', channel: 'WEB' },
      { code: 'DESKTOP_APP', channel: 'DESKTOP' },
      { code: 'OFFLINE', channel: 'BOTH' },
      { code: 'X', channel: 'BOTH' },
    ]);
  });
  it('undefined/null → [] (legado curinga)', () => {
    expect(normalizeFeatureSnapshot(undefined)).toEqual([]);
    expect(snapshotFromRow(null)).toEqual([]);
    expect(snapshotFromRow('x')).toEqual([]);
  });
  it('snapshot do banco volta canônico', () => {
    expect(snapshotFromRow([{ code: 'F1', channel: 'WEB' }, { code: 'F1' }])).toEqual([
      { code: 'F1', channel: 'WEB' },
    ]);
  });
});
