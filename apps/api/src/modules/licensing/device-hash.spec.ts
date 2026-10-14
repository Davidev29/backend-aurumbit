import { computeDeviceHash, decryptLabel, encryptLabel, hashIp, isValidDeviceHash, maskIp24 } from './device-hash';

describe('device-hash (PROJECT.md §4)', () => {
  it('HMAC determinístico por (license, instância) e distinto por instância', () => {
    const a = computeDeviceHash('s', 'lic-1', 'inst-1');
    expect(a).toBe(computeDeviceHash('s', 'lic-1', 'inst-1'));
    expect(isValidDeviceHash(a)).toBe(true);
    expect(computeDeviceHash('s', 'lic-1', 'inst-2')).not.toBe(a);
    expect(computeDeviceHash('s', 'lic-2', 'inst-1')).not.toBe(a);
  });

  it('rejeita hash malformado e segredo vazio', () => {
    expect(isValidDeviceHash('xyz')).toBe(false);
    expect(() => computeDeviceHash('', 'lic-1', 'inst-1')).toThrow();
  });

  it('IP: /24 mascarado, raw nunca persistido (só hash)', () => {
    expect(maskIp24('192.168.10.77')).toBe('192.168.10.0/24');
    expect(maskIp24('2001:db8:abcd:12::1')).toContain('/48');
    expect(maskIp24(null)).toBeNull();
    expect(hashIp('192.168.10.77', 'salt')).not.toContain('192.168.10.77');
  });

  it('label: stub round-trip; formato desconhecido falha fechado', () => {
    expect(decryptLabel(encryptLabel('Meu PC'))).toBe('Meu PC');
    expect(encryptLabel(undefined)).toBeNull();
    expect(() => decryptLabel('aes$gibberish')).toThrow();
  });
});
