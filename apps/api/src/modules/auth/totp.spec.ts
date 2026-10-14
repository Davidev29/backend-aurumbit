import { base32Decode, base32Encode, totpCode, verifyTotp } from './crypto';

// Vetores RFC 4226/6238 (SHA-1): segredo ASCII "12345678901234567890".
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32', () => {
  it('decodifica o vetor RFC', () => {
    expect(base32Decode(SECRET).toString('ascii')).toBe('12345678901234567890');
  });
  it('roundtrip', () => {
    const buf = Buffer.from('hello-mfa');
    expect(base32Decode(base32Encode(buf)).toString('hex')).toBe(buf.toString('hex'));
  });
  it('rejeita alfabeto inválido', () => {
    expect(() => base32Decode('!!!!')).toThrow();
  });
});

describe('totp (RFC 6238, SHA1, 30s, 6 dígitos)', () => {
  it('T=59s (counter 1) → 287082', () => {
    expect(totpCode(SECRET, 59_000)).toBe('287082');
  });
  it('T=0..29s (counter 0) → 755224', () => {
    expect(totpCode(SECRET, 0)).toBe('755224');
    expect(totpCode(SECRET, 29_000)).toBe('755224');
  });
  it('verify aceita janela ±1 passo e rejeita código errado', () => {
    expect(verifyTotp(SECRET, '287082', 59_000)).toBe(true);
    expect(verifyTotp(SECRET, '000000', 59_000)).toBe(false);
    expect(verifyTotp(SECRET, 'abcdef', 59_000)).toBe(false);
  });
});
