// Tipos dos templates de e-mail (Fase 4, PROJECT.md §6).
// Stubs versionados v1: cada template declara `requiredVars` mínimas, sem
// PII sensível (sem e-mail cru, nome, CPF, chave completa — só refs
// mascaradas/opacas + links opacos de TTL curto gerados pelo produtor).

export type TemplateVars = Record<string, unknown>;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailTemplateDef {
  name: string;
  version: 'v1';
  /** Vars obrigatórias (ausência → `MissingTemplateVarError`, poison→DLQ). */
  requiredVars: string[];
  /** Vars opcionais documentadas (toleradas quando ausentes). */
  optionalVars?: string[];
  render(vars: TemplateVars): RenderedEmail;
}

/** Escapa interpolação em HTML (vars vêm de produtores; nunca confiar). */
export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Lê var string com fallback `—` (opcionais nunca quebram o render). */
export function str(vars: TemplateVars, key: string, fallback = '—'): string {
  const v = vars[key];
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return fallback;
}

/** Formata centavos + moeda p/ recibos (`payment-confirmed`). */
export function formatAmount(amountCents: unknown, currency: unknown): string {
  const cents = typeof amountCents === 'number' && Number.isFinite(amountCents) ? amountCents : null;
  const cur = typeof currency === 'string' && currency.length > 0 ? currency : 'BRL';
  if (cents === null) return '—';
  return `${(cents / 100).toFixed(2)} ${cur}`;
}
