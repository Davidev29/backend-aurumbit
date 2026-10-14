// Validador/normalizador de código de barras bancário (puro/testável).
// Aceita linha digitável (47/48 dígitos, com máscara `99999.99999 ...`)
// ou código de barras (44). Normaliza p/ só dígitos; valida:
// - boleto bancário 47 dígitos: 3 blocos mod10 + DV geral mod11;
// - convênio 48 dígitos (4 blocos de 11 + DV): mod10 ou mod11 por bloco
//   (3º dígito da linha: 6/7 → mod10, 8/9 → mod11 — padrão FEBRABAN);
// - barra 44: DV geral mod11 (posição 5).
// Não chama o Asaas; só classifica p/ `canPayViaAsaas` (Bill Payments).

export type BarcodeKind = 'BOLETO_LINHA' | 'CONVENIO_LINHA' | 'BARRA_44';

export interface BarcodeParsed {
  digits: string;
  kind: BarcodeKind;
  /** Dígitos mascarados p/ log/UI (nunca integral em log). */
  masked: string;
}

function onlyDigits(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

export function maskBarcode(digits: string): string {
  const d = onlyDigits(digits);
  if (d.length <= 10) return `***${d.slice(-4)}`;
  return `${d.slice(0, 4)}…${d.slice(-4)} (${d.length}d)`;
}

function mod10Check(blockWithoutDv: string, dv: string): boolean {
  let sum = 0;
  let weight = 2;
  for (let i = blockWithoutDv.length - 1; i >= 0; i--) {
    let prod = Number(blockWithoutDv[i]) * weight;
    if (prod > 9) prod = Math.floor(prod / 10) + (prod % 10);
    sum += prod;
    weight = weight === 2 ? 1 : 2;
  }
  const rest = sum % 10;
  const expected = rest === 0 ? 0 : 10 - rest;
  return expected === Number(dv);
}

function mod11Check(blockWithoutDv: string, dv: string): boolean {
  let sum = 0;
  let weight = 2;
  for (let i = blockWithoutDv.length - 1; i >= 0; i--) {
    sum += Number(blockWithoutDv[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  const expected = rest === 0 || rest === 1 ? 0 : 11 - rest;
  // Convênio mod11: DV 0/1 → 0; boleto usa 1 quando 0/10/11.
  return expected === Number(dv) || (Number(dv) === 1 && (rest === 0 || rest === 10 || rest === 11));
}

/** DV geral do código de barras 44 (posição 5, mod11 boleto). */
function bar44DvOk(bar44: string): boolean {
  const dv = bar44[4];
  const seq = bar44.slice(0, 4) + bar44.slice(5);
  return mod11Check(seq, dv);
}

function boletoLineDvOk(line47: string): boolean {
  // Blocos: [0..9]+DV(9), [10..20]+DV(20), [21..31]+DV(31); DV geral = pos 32.
  const b1 = line47.slice(0, 9);
  const d1 = line47[9];
  const b2 = line47.slice(10, 20);
  const d2 = line47[20];
  const b3 = line47.slice(21, 31);
  const d3 = line47[31];
  if (!mod10Check(b1, d1) || !mod10Check(b2, d2) || !mod10Check(b3, d3)) return false;
  // Monta a barra 44 e confere o DV geral.
  const bar44 =
    line47.slice(0, 3) + // banco
    line47.slice(3, 4) + // moeda
    line47[32] + // DV geral
    line47.slice(33, 37) + // fator vencimento
    line47.slice(37, 47) + // valor
    b1.slice(4, 9) + // campo livre
    b2.slice(0, 10) +
    b3.slice(0, 10);
  if (bar44.length !== 44) return false;
  return bar44DvOk(bar44);
}

function convenioLineDvOk(line48: string): boolean {
  // 4 blocos de 12 (11 dados + DV). Moeda pelo 3º dígito: 6/7→mod10, 8/9→mod11.
  const third = line48[2];
  const use10 = third === '6' || third === '7';
  for (let b = 0; b < 4; b++) {
    const data = line48.slice(b * 12, b * 12 + 11);
    const dv = line48[b * 12 + 11];
    const ok = use10 ? mod10Check(data, dv) : mod11Check(data, dv);
    if (!ok) return false;
  }
  return true;
}

export function parseBarcode(input: string): BarcodeParsed {
  const digits = onlyDigits(input);
  if (digits.length === 47) {
    if (!boletoLineDvOk(digits)) {
      throw new Error('linha digitável inválida (DV não confere)');
    }
    return { digits, kind: 'BOLETO_LINHA', masked: maskBarcode(digits) };
  }
  if (digits.length === 48) {
    if (!convenioLineDvOk(digits)) {
      throw new Error('linha digitável de convênio inválida (DV não confere)');
    }
    return { digits, kind: 'CONVENIO_LINHA', masked: maskBarcode(digits) };
  }
  if (digits.length === 44) {
    if (!bar44DvOk(digits)) {
      throw new Error('código de barras inválido (DV não confere)');
    }
    return { digits, kind: 'BARRA_44', masked: maskBarcode(digits) };
  }
  throw new Error('código de barras deve ter 44 (barra) ou 47/48 (linha digitável) dígitos');
}

/** Normaliza p/ persistir (só dígitos); lança se inválido. */
export function normalizeBarcode(input: string): string {
  return parseBarcode(input).digits;
}
