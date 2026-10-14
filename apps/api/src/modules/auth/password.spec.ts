import { hashPassword, sha256Hex, verifyPassword } from './crypto';

describe('password (Argon2id preferencial, scrypt fallback)', () => {
  it('roundtrip: hash + verify OK', async () => {
    const h = await hashPassword('correct-horse-11');
    expect(typeof h).toBe('string');
    await expect(verifyPassword(h, 'correct-horse-11')).resolves.toBe(true);
  });

  it('senha errada falha', async () => {
    const h = await hashPassword('another-good-12');
    await expect(verifyPassword(h, 'another-good-13')).resolves.toBe(false);
  });

  it('sal único: mesmos plaintexts geram hashes distintos', async () => {
    const a = await hashPassword('same-password-1');
    const b = await hashPassword('same-password-1');
    expect(a).not.toBe(b);
    await expect(verifyPassword(a, 'same-password-1')).resolves.toBe(true);
    await expect(verifyPassword(b, 'same-password-1')).resolves.toBe(true);
  });

  it('formato desconhecido nunca aceita silenciosamente', async () => {
    await expect(verifyPassword(sha256Hex('x'), 'x')).rejects.toThrow();
  });
});
