import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// reset-password v1 — redefinição solicitada. Link opaco de uso único e
// TTL curto (60min, hash-only no DB — REQUIREMENTS §1).
export const resetPasswordTemplate: EmailTemplateDef = {
  name: 'reset-password',
  version: 'v1',
  requiredVars: ['actionUrl', 'expiresInMinutes'],
  render(vars: TemplateVars) {
    const actionUrl = str(vars, 'actionUrl', '#');
    const expires = str(vars, 'expiresInMinutes');
    const subject = 'Redefina sua senha — Aurum Bit';
    const text =
      `Olá,\n\nRecebemos um pedido de redefinição de senha. Use o link abaixo (válido por ${expires} minutos):\n${actionUrl}\n\n` +
      `Se não foi você, ignore esta mensagem e revise a segurança da sua conta.\n— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Recebemos um pedido de redefinição de senha. Clique abaixo (válido por ${escapeHtml(expires)} minutos):</p>` +
      `<p><a href="${escapeHtml(actionUrl)}">Redefinir senha</a></p>` +
      `<p>Se não foi você, ignore esta mensagem e revise a segurança da sua conta.</p><p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
