import { accountBlockedTemplate } from './templates/account-blocked';
import { bonusGrantedTemplate } from './templates/bonus-granted';
import { licenseExpiringTemplate } from './templates/license-expiring';
import { licenseIssuedTemplate } from './templates/license-issued';
import { licenseRenewedTemplate } from './templates/license-renewed';
import { mfaCodeTemplate } from './templates/mfa-code';
import { newDeviceLoginTemplate } from './templates/new-device-login';
import { organizationInviteTemplate } from './templates/organization-invite';
import { paymentConfirmedTemplate } from './templates/payment-confirmed';
import { paymentFailedTemplate } from './templates/payment-failed';
import { paymentOverdueTemplate } from './templates/payment-overdue';
import { resetPasswordTemplate } from './templates/reset-password';
import { subscriptionCancelledTemplate } from './templates/subscription-cancelled';
import { verifyEmailTemplate } from './templates/verify-email';
import type { EmailTemplateDef, RenderedEmail, TemplateVars } from './templates/template.types';

// Registry de templates — Fase 4 (PROJECT.md §6, REQUIREMENTS.md §4).
// Escopo real v1: exatamente os 14 abaixo (`template + template_version`
// persistidos em `EmailMessage`). Versão default e única suportada: `v1`.

const REGISTRY = {
  'verify-email': verifyEmailTemplate,
  'reset-password': resetPasswordTemplate,
  'new-device-login': newDeviceLoginTemplate,
  'account-blocked': accountBlockedTemplate,
  'mfa-code': mfaCodeTemplate,
  'organization-invite': organizationInviteTemplate,
  'payment-confirmed': paymentConfirmedTemplate,
  'payment-failed': paymentFailedTemplate,
  'payment-overdue': paymentOverdueTemplate,
  'subscription-cancelled': subscriptionCancelledTemplate,
  'license-issued': licenseIssuedTemplate,
  'license-expiring': licenseExpiringTemplate,
  'license-renewed': licenseRenewedTemplate,
  'bonus-granted': bonusGrantedTemplate,
} as const satisfies Record<string, EmailTemplateDef>;

export type TemplateName = keyof typeof REGISTRY;

/** Os 14 templates do escopo real (PROJECT.md §6). */
export const TEMPLATE_NAMES = Object.keys(REGISTRY) as TemplateName[];

/**
 * Resíduo wallet/crypto do draft — NÃO pertence ao Aurum Bit, nunca
 * renderizado. Erro explícito (em vez de "template desconhecido") para
 * o produtor corrigir o mapeamento.
 */
export const OUT_OF_SCOPE_TEMPLATES = ['deposit-confirmed', 'withdrawal-confirm', 'order-filled'] as const;

export class UnknownTemplateError extends Error {
  constructor(name: string) {
    super(`template desconhecido: ${name}`);
    this.name = 'UnknownTemplateError';
  }
}

export class OutOfScopeTemplateError extends Error {
  constructor(name: string) {
    super(`template fora de escopo (PROJECT.md §6): ${name} não pertence ao Aurum Bit`);
    this.name = 'OutOfScopeTemplateError';
  }
}

export class UnsupportedTemplateVersionError extends Error {
  constructor(name: string, version: string) {
    super(`template ${name} sem versão ${version} (suportada: v1)`);
    this.name = 'UnsupportedTemplateVersionError';
  }
}

export class MissingTemplateVarError extends Error {
  readonly missing: string[];
  constructor(name: string, missing: string[]) {
    super(`template ${name} sem vars obrigatórias: ${missing.join(', ')}`);
    this.name = 'MissingTemplateVarError';
    this.missing = missing;
  }
}

/** Recupera a definição (valida escopo + versão). */
export function getTemplate(name: string, version = 'v1'): EmailTemplateDef {
  if ((OUT_OF_SCOPE_TEMPLATES as readonly string[]).includes(name)) {
    throw new OutOfScopeTemplateError(name);
  }
  const def = (REGISTRY as Record<string, EmailTemplateDef>)[name];
  if (!def) throw new UnknownTemplateError(name);
  if (version !== def.version) throw new UnsupportedTemplateVersionError(name, version);
  return def;
}

/** Renderiza validando as vars obrigatórias (ausência = poison, vai p/ DLQ). */
export function renderTemplate(name: string, version: string | undefined, vars: TemplateVars): RenderedEmail {
  const def = getTemplate(name, version ?? 'v1');
  const missing = def.requiredVars.filter((k) => {
    const v = vars[k];
    return !(typeof v === 'string' ? v.length > 0 : typeof v === 'number' && Number.isFinite(v));
  });
  if (missing.length > 0) throw new MissingTemplateVarError(name, missing);
  return def.render(vars);
}
