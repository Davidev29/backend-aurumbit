import { detectCloneSuspect } from './clone-policy';

const NOW = new Date('2026-10-10T12:00:00.000Z');

describe('detectCloneSuspect (PROJECT.md §4)', () => {
  it('sem sinais → sem suspeita', () => {
    const v = detectCloneSuspect(
      { lastSeenAt: new Date('2026-10-10T11:00:00Z'), lastCountry: 'BR', lastCtr: 5 },
      { at: NOW, country: 'BR', tokenIatS: Math.floor(NOW.getTime() / 1000), ctr: 6 },
      NOW,
    );
    expect(v).toEqual({ suspect: false, reasons: [], evidence: {} });
  });

  it('iat futuro além da tolerância → future-iat', () => {
    const v = detectCloneSuspect(
      { lastSeenAt: new Date('2026-10-10T11:00:00Z'), lastCountry: 'BR', lastCtr: 5 },
      { at: NOW, country: 'BR', tokenIatS: Math.floor(NOW.getTime() / 1000) + 3600, ctr: 6 },
      NOW,
    );
    expect(v.suspect).toBe(true);
    expect(v.reasons).toContain('future-iat');
  });

  it('iat dentro da tolerância (5min) → sem suspeita', () => {
    const v = detectCloneSuspect(
      { lastSeenAt: new Date('2026-10-10T11:00:00Z'), lastCountry: 'BR', lastCtr: 5 },
      { at: NOW, country: 'BR', tokenIatS: Math.floor(NOW.getTime() / 1000) + 60, ctr: 6 },
      NOW,
    );
    expect(v.suspect).toBe(false);
  });

  it('contador divergente (rollback) → ctr-rollback', () => {
    const v = detectCloneSuspect(
      { lastSeenAt: new Date('2026-10-10T11:00:00Z'), lastCountry: 'BR', lastCtr: 9 },
      { at: NOW, country: 'BR', ctr: 4 },
      NOW,
    );
    expect(v.suspect).toBe(true);
    expect(v.reasons).toContain('ctr-rollback');
  });

  it('mesmo país / país ausente → sem impossible-travel', () => {
    for (const country of ['BR', null, undefined]) {
      const v = detectCloneSuspect(
        { lastSeenAt: new Date('2026-10-10T11:00:00Z'), lastCountry: 'BR', lastCtr: 1 },
        { at: NOW, country: country ?? null, ctr: 2 },
        NOW,
      );
      expect(v.reasons).not.toContain('impossible-travel');
    }
  });

  it('troca de país em <2h → impossible-travel (sinal, geo aproximada)', () => {
    const v = detectCloneSuspect(
      { lastSeenAt: new Date('2026-10-10T11:30:00Z'), lastCountry: 'BR', lastCtr: 2 },
      { at: NOW, country: 'JP', ctr: 3 },
      NOW,
    );
    expect(v.suspect).toBe(true);
    expect(v.reasons).toContain('impossible-travel');
    expect(v.evidence.impossibleTravel).toMatchObject({ fromCountry: 'BR', toCountry: 'JP' });
  });

  it('troca de país após 2h → sem suspeita (viagem plausível)', () => {
    const v = detectCloneSuspect(
      { lastSeenAt: new Date('2026-10-09T12:00:00Z'), lastCountry: 'BR', lastCtr: 2 },
      { at: NOW, country: 'PT', ctr: 3 },
      NOW,
    );
    expect(v.suspect).toBe(false);
  });
});
