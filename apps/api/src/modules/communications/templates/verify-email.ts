import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// verify-email v1 — confirmação de cadastro. Link opaco de uso único e
// TTL curto gerado pelo produtor (auth); expira em `expiresInMinutes`.
export const verifyEmailTemplate: EmailTemplateDef = {
  name: 'verify-email',
  version: 'v1',
  requiredVars: ['actionUrl', 'expiresInMinutes'],
  render(vars: TemplateVars) {
    const actionUrl = str(vars, 'actionUrl', '#');
    const expires = str(vars, 'expiresInMinutes');
    const subject = 'Confirme seu e-mail — Aurum Bit';
    const text =
      `Olá,\n\nConfirme seu e-mail acessando o link abaixo (válido por ${expires} minutos):\n${actionUrl}\n\n` +
      `Se você não criou uma conta, ignore esta mensagem.\n— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Confirme seu e-mail clicando no botão abaixo (válido por ${escapeHtml(expires)} minutos):</p>` +
      `<p><a href="${escapeHtml(actionUrl)}">Confirmar e-mail</a></p>` +
      `<p>Se você não criou uma conta, ignore esta mensagem.</p><p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
