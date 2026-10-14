import { AccessEvaluatorService } from './access-evaluator.service';
import {
  accessCacheKeys,
  evaluateRow,
  graceUntilFor,
  nextStatusByTime,
  offlineExpiry,
  requestResume,
  summarizeTransitions,
  toMs,
} from './evaluator.transitions';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const T = (iso: string): number => Date.parse(iso);

describe('nextStatusByTime — matriz PROJECT.md §1', () => {
  const cases: Array<{
    name: string;
    status: string;
    exp: string | null;
    grace: string | null;
    now: string;
    want: string;
  }> = [
    { name: 'ACTIVE vigente → ACTIVE', status: 'ACTIVE', exp: '2026-11-10T12:00:00Z', grace: '2026-11-13T12:00:00Z', now: '2026-10-10T12:00:00Z', want: 'ACTIVE' },
    { name: 'fronteira now==expires → ACTIVE (SQL < estrito)', status: 'ACTIVE', exp: '2026-10-10T12:00:00Z', grace: '2026-10-13T12:00:00Z', now: '2026-10-10T12:00:00Z', want: 'ACTIVE' },
    { name: 'ACTIVE em graça → GRACE', status: 'ACTIVE', exp: '2026-10-09T12:00:00Z', grace: '2026-10-12T12:00:00Z', now: '2026-10-10T12:00:00Z', want: 'GRACE' },
    { name: 'fronteira now==grace → GRACE (SQL >= )', status: 'ACTIVE', exp: '2026-10-09T12:00:00Z', grace: '2026-10-10T12:00:00Z', now: '2026-10-10T12:00:00Z', want: 'GRACE' },
    { name: 'ACTIVE após graça → EXPIRED', status: 'ACTIVE', exp: '2026-10-01T12:00:00Z', grace: '2026-10-04T12:00:00Z', now: '2026-10-10T12:00:00Z', want: 'EXPIRED' },
    { name: 'ACTIVE expirado sem graça → EXPIRED', status: 'ACTIVE', exp: '2026-10-01T12:00:00Z', grace: null, now: '2026-10-10T12:00:00Z', want: 'EXPIRED' },
    { name: 'ACTIVE vitalícia (exp null) → ACTIVE', status: 'ACTIVE', exp: null, grace: null, now: '2026-10-10T12:00:00Z', want: 'ACTIVE' },
    { name: 'GRACE dentro da janela → GRACE', status: 'GRACE', exp: '2026-10-09T12:00:00Z', grace: '2026-10-12T12:00:00Z', now: '2026-10-10T12:00:00Z', want: 'GRACE' },
    { name: 'GRACE após janela → EXPIRED', status: 'GRACE', exp: '2026-10-01T12:00:00Z', grace: '2026-10-04T12:00:00Z', now: '2026-10-10T12:00:00Z', want: 'EXPIRED' },
    { name: 'GRACE com datas estendidas (renew) → ACTIVE', status: 'GRACE', exp: '2026-11-10T12:00:00Z', grace: '2026-11-13T12:00:00Z', now: '2026-10-10T12:00:00Z', want: 'ACTIVE' },
    { name: 'SUSPENDED passado → SUSPENDED (tempo nunca resume)', status: 'SUSPENDED', exp: '2026-09-01T12:00:00Z', grace: '2026-09-04T12:00:00Z', now: '2026-10-10T12:00:00Z', want: 'SUSPENDED' },
    { name: 'REVOKED terminal mesmo expirado', status: 'REVOKED', exp: '2026-09-01T12:00:00Z', grace: '2026-09-04T12:00:00Z', now: '2026-10-10T12:00:00Z', want: 'REVOKED' },
    { name: 'EXPIRED terminal', status: 'EXPIRED', exp: '2027-01-01T12:00:00Z', grace: '2027-01-04T12:00:00Z', now: '2026-10-10T12:00:00Z', want: 'EXPIRED' },
    { name: 'status desconhecido passa intacto', status: 'PENDING', exp: '2026-09-01T12:00:00Z', grace: null, now: '2026-10-10T12:00:00Z', want: 'PENDING' },
  ];
  it.each(cases)('$name', (c) => {
    expect(
      nextStatusByTime(c.status, T(c.now), c.exp ? T(c.exp) : null, c.grace ? T(c.grace) : null),
    ).toBe(c.want);
  });

  it('evaluateRow marca changed só em transição', () => {
    const changed = evaluateRow({ id: 'a', status: 'ACTIVE', expiresAt: new Date('2026-10-09T12:00:00Z'), graceUntil: new Date('2026-10-12T12:00:00Z') }, NOW);
    expect(changed).toMatchObject({ id: 'a', from: 'ACTIVE', to: 'GRACE', changed: true });
    const same = evaluateRow({ id: 'b', status: 'REVOKED', expiresAt: new Date('2020-01-01T00:00:00Z'), graceUntil: null }, NOW);
    expect(same).toMatchObject({ from: 'REVOKED', to: 'REVOKED', changed: false });
  });

  it('summarizeTransitions conta por destino', () => {
    const rows = [
      { id: '1', status: 'ACTIVE', expiresAt: new Date('2026-10-09T12:00:00Z'), graceUntil: new Date('2026-10-12T12:00:00Z') },
      { id: '2', status: 'GRACE', expiresAt: new Date('2026-10-01T12:00:00Z'), graceUntil: new Date('2026-10-04T12:00:00Z') },
      { id: '3', status: 'GRACE', expiresAt: new Date('2026-11-10T12:00:00Z'), graceUntil: new Date('2026-11-13T12:00:00Z') },
      { id: '4', status: 'REVOKED', expiresAt: new Date('2020-01-01T00:00:00Z'), graceUntil: null },
    ].map((r) => evaluateRow(r, NOW));
    expect(summarizeTransitions(rows)).toEqual({ total: 4, toGrace: 1, toActive: 1, toExpired: 1, unchanged: 1 });
  });
});

describe('requestResume (suspended→active; terminais intactos)', () => {
  it.each([
    ['SUSPENDED', 'ACTIVE'],
    ['ACTIVE', 'ACTIVE'],
    ['GRACE', 'GRACE'],
    ['REVOKED', 'REVOKED'],
    ['EXPIRED', 'EXPIRED'],
  ])('%s → %s', (from, want) => {
    expect(requestResume(from)).toBe(want);
  });
});

describe('helpers temporais §1', () => {
  it('grace_until = expires_at + 3d', () => {
    expect(graceUntilFor(new Date('2026-10-10T12:00:00Z')).toISOString()).toBe('2026-10-13T12:00:00.000Z');
  });
  it('off_exp = min(iat+7d, expires+7d)', () => {
    const iat = new Date('2026-10-10T12:00:00Z');
    expect(offlineExpiry(iat, new Date('2027-01-01T12:00:00Z')).toISOString()).toBe('2026-10-17T12:00:00.000Z');
    // Teto é expires+7d quando ele é o menor (renovação em cima da hora).
    expect(offlineExpiry(iat, new Date('2026-10-09T12:00:00Z')).toISOString()).toBe('2026-10-16T12:00:00.000Z');
  });
  it('toMs tolera null e inválido', () => {
    expect(toMs(null)).toBeNull();
    expect(toMs('não-data')).toBeNull();
  });
});

describe('accessCacheKeys', () => {
  it('emite variantes de canal + alias access:{owner}:{product}:{feature}', () => {
    expect(accessCacheKeys('CUSTOMER', 'o1', 'p1', 'F1')).toEqual([
      'access:check:v1:CUSTOMER:o1:p1:F1:WEB',
      'access:check:v1:CUSTOMER:o1:p1:F1:DESKTOP',
      'access:check:v1:CUSTOMER:o1:p1:F1:ANY',
      'access:o1:p1:F1',
    ]);
  });
});

describe('AccessEvaluatorService.preview (puro, sem banco)', () => {
  it('replica a matriz sem I/O', () => {
    const svc = new AccessEvaluatorService({} as never);
    const { summary } = svc.preview(
      [
        { id: '1', status: 'ACTIVE', expiresAt: new Date('2026-10-09T12:00:00Z'), graceUntil: new Date('2026-10-12T12:00:00Z') },
        { id: '2', status: 'ACTIVE', expiresAt: new Date('2026-10-01T12:00:00Z'), graceUntil: new Date('2026-10-04T12:00:00Z') },
      ],
      NOW,
    );
    expect(summary).toMatchObject({ total: 2, toGrace: 1, toExpired: 1, unchanged: 0 });
  });
});
