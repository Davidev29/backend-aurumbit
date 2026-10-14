import { normalizeBarcode, parseBarcode } from './barcode';

// Cobertura do validador: linha 47 válida (exemplo Asaas docs),
// convênio 48 válido sintético, rejeições + máscara sem vazar número.
describe('barcode — linha digitável / barra', () => {
  it('aceita linha 47 válida (exemplo docs Asaas)', () => {
    const line = '00190000090275928800021932978170187890000005000';
    const p = parseBarcode(line);
    expect(p.kind).toBe('BOLETO_LINHA');
    expect(p.digits).toBe(line);
    expect(p.masked).not.toContain(line);
    expect(normalizeBarcode('00190.00009 02759.288000 21932.978170 1 87890000005000')).toBe(line);
  });

  it('rejeita linha 47 com DV errado', () => {
    expect(() => parseBarcode('00190000090275928800021932978170187890000005001')).toThrow(/DV/);
  });

  it('rejeita tamanho fora de 44/47/48', () => {
    expect(() => parseBarcode('12345')).toThrow(/44.*47\/48|47\/48/);
    expect(() => parseBarcode('1234567890'.repeat(5))).toThrow();
  });

  it('aceita convênio 48 com DVs mod10 consistentes', () => {
    // Gera linha 48 válida: 4 blocos de 11 dados + DV mod10 (3º dígito 6).
    const mod10Dv = (data: string): string => {
      let sum = 0;
      let w = 2;
      for (let i = data.length - 1; i >= 0; i--) {
        let p = Number(data[i]) * w;
        if (p > 9) p = Math.floor(p / 10) + (p % 10);
        sum += p;
        w = w === 2 ? 1 : 2;
      }
      const r = sum % 10;
      return String(r === 0 ? 0 : 10 - r);
    };
    const b1 = '84660000001';
    const b2 = '12345678901';
    const b3 = '23456789012';
    const b4 = '34567890123';
    // força 3º dígito = 6 (mod10)
    const d1 = '84' + '6' + b1.slice(3);
    const line = d1 + mod10Dv(d1) + b2 + mod10Dv(b2) + b3 + mod10Dv(b3) + b4 + mod10Dv(b4);
    expect(line).toHaveLength(48);
    expect(parseBarcode(line).kind).toBe('CONVENIO_LINHA');
  });

  it('máscara nunca expõe o número integral', () => {
    const p = parseBarcode('00190000090275928800021932978170187890000005000');
    expect(p.masked).toBe('0019…5000 (47d)');
  });
});
