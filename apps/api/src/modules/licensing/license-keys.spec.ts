import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KEY_FORMAT,
  calcExpiry,
  decryptLicenseKey,
  effectiveStatus,
  encryptLicenseKey,
  generateLicenseKey,
  maskFromParts,
  maskLicenseKey,
  masterKeys,
  sha256Hex,
} from './license-keys';

const START = new Date('2026-01-15T10:00:00.000Z');

describe('calcExpiry (PROJECT.md §1 — pura e determinística)', () => {
  it('monthly: +1M calendário UTC, grace +3d', () => {
    const { expiresAt, graceUntil } = calcExpiry(START, 'monthly');
    expect(expiresAt!.toISOString()).toBe('2026-02-15T10:00:00.000Z');
    expect(graceUntil!.toISOString()).toBe('2026-02-18T10:00:00.000Z');
  });

  it('annual: +12M calendário UTC, grace +3d', () => {
    const { expiresAt, graceUntil } = calcExpiry(new Date('2026-03-10T00:00:00.000Z'), 'annual');
    expect(expiresAt!.toISOString()).toBe('2027-03-10T00:00:00.000Z');
    expect(graceUntil!.toISOString()).toBe('2027-03-13T00:00:00.000Z');
  });

  it('fim de mês é determinístico (31/jan +1M → 3/mar, overflow UTC documentado)', () => {
    const { expiresAt, graceUntil } = calcExpiry(new Date('2026-01-31T10:00:00.000Z'), 'monthly');
    expect(expiresAt!.toISOString()).toBe('2026-03-03T10:00:00.000Z');
    expect(graceUntil!.toISOString()).toBe('2026-03-06T10:00:00.000Z');
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
    expect(new Date(Math.max(early.getTime(), prev.expiresAt!.getTime())).toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
    // Em grace (exp < now <= grace): starts_at = now; sem lacuna de NEGAÇÃO
    // porque a graça cobre até 04/fev (allow degradado) e a nova vigência
    // começa em 02/fev — janelas sobrepostas, sem dia negado.
    const inGrace = new Date('2026-02-02T12:00:00.000Z');
    const startsAt = new Date(Math.max(inGrace.getTime(), prev.expiresAt!.getTime()));
    expect(startsAt.toISOString()).toBe('2026-02-02T12:00:00.000Z');
    expect(prev.graceUntil!.getTime()).toBeGreaterThanOrEqual(startsAt.getTime());
    const next = calcExpiry(startsAt, 'monthly');
    expect(next.expiresAt!.toISOString()).toBe('2026-03-02T12:00:00.000Z');
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

describe('key_enc envelope v2 (mestra em arquivo + dual-decrypt)', () => {
  const HEX_A = 'ab'.repeat(32);
  const HEX_B = 'cd'.repeat(32);
  let dir = '';
  let savedCur: string | undefined;
  let savedPrev: string | undefined;
  let savedEnv: string | undefined;

  const masterFile = (hex: string): string => {
    const p = join(dir, `master-${Math.random().toString(36).slice(2)}.key`);
    writeFileSync(p, `${hex}\n`, { mode: 0o600 });
    return p;
  };

  beforeEach(() => {
    savedCur = process.env.LICENSE_MASTER_KEY_PATH;
    savedPrev = process.env.LICENSE_MASTER_KEY_PREVIOUS_PATH;
    savedEnv = process.env.LICENSE_KEY_ENC_KEY;
    delete process.env.LICENSE_MASTER_KEY_PATH;
    delete process.env.LICENSE_MASTER_KEY_PREVIOUS_PATH;
    delete process.env.LICENSE_KEY_ENC_KEY;
    dir = mkdtempSync(join(tmpdir(), 'lic-master-'));
  });

  afterEach(() => {
    if (savedCur === undefined) delete process.env.LICENSE_MASTER_KEY_PATH;
    else process.env.LICENSE_MASTER_KEY_PATH = savedCur;
    if (savedPrev === undefined) delete process.env.LICENSE_MASTER_KEY_PREVIOUS_PATH;
    else process.env.LICENSE_MASTER_KEY_PREVIOUS_PATH = savedPrev;
    if (savedEnv === undefined) delete process.env.LICENSE_KEY_ENC_KEY;
    else process.env.LICENSE_KEY_ENC_KEY = savedEnv;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('round-trip v2 com mestra atual', () => {
    process.env.LICENSE_MASTER_KEY_PATH = masterFile(HEX_A);
    expect(masterKeys()).toHaveLength(1);
    const k = generateLicenseKey(() => Buffer.alloc(16, 9));
    const enc = encryptLicenseKey(k);
    expect(enc).toMatch(/^v2\.[^.]+\.[^.]+\.[^.]+\.[^.]+\.[^.]+$/);
    expect(enc).not.toContain(k.slice(6));
    expect(decryptLicenseKey(enc as string)).toBe(k);
  });

  it('dual-decrypt: envelope da mestra anterior ainda abre após rotação', () => {
    const pathA = masterFile(HEX_A);
    const pathB = masterFile(HEX_B);
    process.env.LICENSE_MASTER_KEY_PATH = pathA;
    const k = generateLicenseKey(() => Buffer.alloc(16, 11));
    const old = encryptLicenseKey(k) as string;
    expect(old).toMatch(/^v2\./);
    // Rotação: nova mestra atual + anterior em PREVIOUS_PATH.
    process.env.LICENSE_MASTER_KEY_PATH = pathB;
    process.env.LICENSE_MASTER_KEY_PREVIOUS_PATH = pathA;
    expect(masterKeys()).toHaveLength(2);
    expect(decryptLicenseKey(old)).toBe(k);
    // Chave nova sai cifrada pela mestra atual (abre sem a anterior).
    const fresh = encryptLicenseKey(k) as string;
    delete process.env.LICENSE_MASTER_KEY_PREVIOUS_PATH;
    expect(decryptLicenseKey(fresh)).toBe(k);
  });

  it('legado v1 ainda abre (env direto, sem master file)', () => {
    process.env.LICENSE_KEY_ENC_KEY = HEX_A;
    const k = generateLicenseKey(() => Buffer.alloc(16, 9));
    const enc = encryptLicenseKey(k);
    expect(enc).toMatch(/^v1\./);
    expect(decryptLicenseKey(enc as string)).toBe(k);
  });

  it('sem segredo algum → encrypt null, decrypt throw', () => {
    expect(masterKeys()).toHaveLength(0);
    expect(encryptLicenseKey('AURUM-AAAA-BBBB-CCCC')).toBeNull();
    expect(() => decryptLicenseKey('v2.x.y.z.w.q')).toThrow('segredo de cifra ausente');
    expect(() => decryptLicenseKey('v1.a.b.c')).toThrow('segredo de cifra ausente');
  });
});
