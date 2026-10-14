import { createHash, randomBytes } from 'node:crypto';
import {
  KEY_FORMAT,
  calcExpiry,
  decryptLicenseKey,
  effectiveStatus,
  encryptLicenseKey,
  generateLicenseKey,
  maskFromParts,
  maskLicenseKey,
  sha256Hex,
} from './license-keys';

const START = new Date('2026-01-15T10:00:00.000Z');

describe('calcExpiry (PROJECT.md §1 — pura e determinística)', () => {
  it('monthly: +1M calendário UTC, grace +3d', () => {
    const { expiresAt, graceUntil } = calcExpiry(START, 'monthly');
    expect(expiresAt.toISOString()).toBe('2026-02-15T10:00:00.000Z');
    expect(graceUntil.toISOString()).toBe('2026-02-18T10:00:00.000Z');
  });

  it('annual: +12M calendário UTC, grace +3d', () => {
    const { expiresAt, graceUntil } = calcExpiry(new Date('2026-03-10T00:00:00.000Z'), 'annual');
    expect(expiresAt.toISOString()).toBe('2027-03-10T00:00:00.000Z');
    expect(graceUntil.toISOString()).toBe('2027-03-13T00:00:00.000Z');
  });

  it('fim de mês é determinístico (31/jan +1M → 3/mar, overflow UTC documentado)', () => {
    const { expiresAt, graceUntil } = calcExpiry(new Date('2026-01-31T10:00:00.000Z'), 'monthly');
    expect(expiresAt.toISOString()).toBe('2026-03-03T10:00:00.000Z');
    expect(graceUntil.toISOString()).toBe('2026-03-06T10:00:00.000Z');
  });

  it('pura: mesma entrada → mesma saída, sem mutar a entrada', () => {
    const a = calcExpiry(START, 'monthly');
    const b = calcExpiry(new Date(START.getTime()), 'monthly');
    expect(a).toEqual(b);
    expect(START.toISOString()).toBe('2026-01-15T10:00:00.000Z');
  });

  it('rejeita entrada/kind inválidos', () => {
    expect(() => calcExpiry(new Date('x'), 'monthly')).toThrow();
    expect(() => calcExpiry(START, 'weekly' as never)).toThrow();
  });

  it('renovação: starts_at = max(now, expires_anterior) (PROJECT.md §1)', () => {
    const prev = calcExpiry(new Date('2026-01-01T00:00:00.000Z'), 'monthly'); // exp 01/fev, grace 04/fev
    // Antecipada (now < exp): continua do vencimento, sem sobreposição.
    const early = new Date('2026-01-20T00:00:00.000Z');
    expect(new Date(Math.max(early.getTime(), prev.expiresAt.getTime())).toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
    // Em grace (exp < now <= grace): starts_at = now; sem lacuna de NEGAÇÃO
    // porque a graça cobre até 04/fev (allow degradado) e a nova vigência
    // começa em 02/fev — janelas sobrepostas, sem dia negado.
    const inGrace = new Date('2026-02-02T12:00:00.000Z');
    const startsAt = new Date(Math.max(inGrace.getTime(), prev.expiresAt.getTime()));
    expect(startsAt.toISOString()).toBe('2026-02-02T12:00:00.000Z');
    expect(prev.graceUntil.getTime()).toBeGreaterThanOrEqual(startsAt.getTime());
    const next = calcExpiry(startsAt, 'monthly');
    expect(next.expiresAt.toISOString()).toBe('2026-03-02T12:00:00.000Z');
  });

  it('renovação após a graça: starts_at = now', () => {
    const prevExpires = new Date('2026-02-01T00:00:00.000Z').getTime();
    const now = new Date('2026-03-10T00:00:00.000Z');
    expect(new Date(Math.max(now.getTime(), prevExpires)).toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });
});

describe('effectiveStatus', () => {
  const base = { expiresAt: new Date('2026-11-10T12:00:00Z'), graceUntil: new Date('2026-11-13T12:00:00Z') };
  const NOW = new Date('2026-10-10T12:00:00.000Z');
  it('active vigente', () => {
    expect(effectiveStatus({ status: 'active', ...base }, NOW)).toBe('active');
  });
  it('grace degradado', () => {
    expect(
      effectiveStatus({ status: 'active', expiresAt: new Date('2026-10-09T12:00Z'), graceUntil: new Date('2026-10-12T12:00Z') }, NOW),
    ).toBe('grace');
  });
  it('expired após a graça', () => {
    expect(
      effectiveStatus({ status: 'active', expiresAt: new Date('2026-10-01T12:00Z'), graceUntil: new Date('2026-10-04T12:00Z') }, NOW),
    ).toBe('expired');
  });
  it('lifecycle persistido vence datas (suspended/revoked/pending_payment)', () => {
    expect(effectiveStatus({ status: 'suspended', ...base }, NOW)).toBe('suspended');
    expect(effectiveStatus({ status: 'revoked', ...base }, NOW)).toBe('revoked');
    expect(effectiveStatus({ status: 'pending_payment', ...base }, NOW)).toBe('pending_payment');
  });
});

describe('generateLicenseKey (PROJECT.md §2)', () => {
  it('formato AURUM-XXXX-XXXX-XXXX no alfabeto sem ambiguidade', () => {
    for (let i = 0; i < 25; i++) expect(generateLicenseKey()).toMatch(KEY_FORMAT);
  });
  it('fonte CSPRNG de 128 bits', () => {
    let seen = 0;
    generateLicenseKey((n: number) => {
      seen = n;
      return randomBytes(n);
    });
    expect(seen).toBe(16);
  });
  it('determinística com rand injetado; entradas distintas → chaves distintas', () => {
    const a = generateLicenseKey(() => Buffer.alloc(16, 1));
    const b = generateLicenseKey(() => Buffer.alloc(16, 1));
    const c = generateLicenseKey(() => Buffer.alloc(16, 2));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(KEY_FORMAT);
  });
  it('sha256Hex confere com crypto (key_hash UNIQUE)', () => {
    const k = generateLicenseKey(() => Buffer.alloc(16, 7));
    expect(sha256Hex(k)).toBe(createHash('sha256').update(k, 'utf8').digest('hex'));
    expect(sha256Hex(k)).toHaveLength(64);
  });
});

describe('reveal-mask (PROJECT.md §2)', () => {
  it('mascara meio, preserva last4', () => {
    expect(maskLicenseKey('AURUM-ABCD-EFGH-IJ12')).toBe('AURUM-••••-••••-IJ12');
  });
  it('maskFromParts nunca expõe meio da chave', () => {
    const m = maskFromParts('IJ12');
    expect(m).toBe('AURUM-••••-••••-IJ12');
    expect(m).not.toContain('ABCD');
  });
  it('entrada fora do padrão → máscara total', () => {
    expect(maskLicenseKey('qualquer-coisa')).toBe('••••');
    expect(maskLicenseKey('')).toBe('••••');
  });
});

describe('key_enc (AES-256-GCM)', () => {
  const HEX64 = 'ab'.repeat(32);
  it('round-trip com segredo configurado', () => {
    process.env.LICENSE_KEY_ENC_KEY = HEX64;
    const k = generateLicenseKey(() => Buffer.alloc(16, 9));
    const enc = encryptLicenseKey(k);
    expect(enc).toMatch(/^v1\./);
    expect(enc).not.toContain(k.slice(6));
    expect(decryptLicenseKey(enc as string)).toBe(k);
    delete process.env.LICENSE_KEY_ENC_KEY;
  });
  it('sem segredo → null (reveal indisponível)', () => {
    delete process.env.LICENSE_KEY_ENC_KEY;
    expect(encryptLicenseKey('AURUM-AAAA-BBBB-CCCC')).toBeNull();
  });
});
