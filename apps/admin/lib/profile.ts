import type { UserDocument, UserDocumentType } from "./types";

/** Máscaras p/ listagem (LGPD — nunca exibe número integral fora da edição). */
export function maskDocNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return raw.trim() ? `***·${digits}` : "—";
  return `***·${digits.slice(-4)}`;
}

export function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}

export function maskCep(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length === 8) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return raw;
}

export function validateProfilePersonal(v: {
  nomeExibicao: string;
  email: string;
  telefone?: string;
  celular?: string;
  dataNascimento?: string | null;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!v.nomeExibicao.trim()) errors.nomeExibicao = "Informe como seu nome aparece no sistema.";
  if (!v.nomeExibicao.trim() || v.nomeExibicao.trim().length < 2)
    errors.nomeExibicao = errors.nomeExibicao ?? "Nome muito curto (mín. 2 caracteres).";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) errors.email = "E-mail inválido.";
  const phoneOk = (p?: string): boolean => {
    if (!p?.trim()) return true;
    return p.replace(/\D/g, "").length >= 10;
  };
  if (!phoneOk(v.telefone)) errors.telefone = "Telefone incompleto (com DDD, 10–11 dígitos).";
  if (!phoneOk(v.celular)) errors.celular = "Celular incompleto (com DDD, 10–11 dígitos).";
  if (v.dataNascimento) {
    const t = Date.parse(v.dataNascimento);
    if (Number.isNaN(t)) errors.dataNascimento = "Data inválida.";
    else if (t > Date.now()) errors.dataNascimento = "Data de nascimento não pode ser futura.";
  }
  return errors;
}

export function validateAddress(v: {
  cep?: string;
  uf?: string;
  cidade?: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (v.cep?.trim() && v.cep.replace(/\D/g, "").length !== 8) errors.cep = "CEP tem 8 dígitos.";
  if (v.uf?.trim() && v.uf.trim().length !== 2) errors.uf = "UF tem 2 letras.";
  return errors;
}

export function validateDocument(v: { tipo: UserDocumentType | ""; numero: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!v.tipo) errors.tipo = "Escolha o tipo do documento.";
  if (!v.numero.trim()) errors.numero = "Informe o número do documento.";
  else if (v.numero.trim().length < 4) errors.numero = "Número muito curto.";
  return errors;
}

export const DOCUMENT_LABELS: Record<UserDocumentType, string> = {
  RG: "RG",
  CNH: "CNH",
  CPF: "CPF",
  PASSAPORTE: "Passaporte",
  CTPS: "Carteira de trabalho",
  TITULO_ELEITOR: "Título de eleitor",
  OUTRO: "Outro",
};

export function newDocumentId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function toMaskedDocument(input: {
  tipo: UserDocumentType;
  numero: string;
  orgaoEmissor?: string;
  uf?: string;
  validade?: string | null;
  anexoNome?: string | null;
  anexoTamanho?: number | null;
}): UserDocument {
  return {
    id: newDocumentId(),
    tipo: input.tipo,
    numeroMasked: maskDocNumber(input.numero),
    numero: input.numero.trim(),
    orgaoEmissor: input.orgaoEmissor?.trim() || undefined,
    uf: input.uf?.trim().toUpperCase() || undefined,
    validade: input.validade || null,
    anexoNome: input.anexoNome ?? null,
    anexoTamanho: input.anexoTamanho ?? null,
    createdAt: new Date().toISOString(),
  };
}
