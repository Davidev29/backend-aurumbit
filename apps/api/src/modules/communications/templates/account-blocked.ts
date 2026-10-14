import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// account-blocked v1 — bloqueio por segurança (ex. lockout). Só o código
// do motivo (`reasonCode`), sem detalhes investigativos no corpo.
export const accountBlockedTemplate: EmailTemplateDef = {
  name: 'account-blocked',
  version: 'v1',
  requiredVars: ['reasonCode', 'supportUrl'],
  render(vars: TemplateVars) {
    const reasonCode = str(vars, 'reasonCode');
    const supportUrl = str(vars, 'supportUrl', '#');
    const subject = 'Sua conta foi bloqueada por segurança — Aurum Bit';
    const text =
      `Olá,\n\nSua conta foi temporariamente bloqueada por segurança (motivo: ${reasonCode}).\n\n` +
      `Fale com o suporte para recuperar o acesso:\n${supportUrl}\n— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Sua conta foi temporariamente bloqueada por segurança ` +
      `(motivo: <strong>${escapeHtml(reasonCode)}</strong>).</p>` +
      `<p><a href="${escapeHtml(supportUrl)}">Falar com o suporte</a></p><p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
