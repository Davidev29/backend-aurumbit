import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// organization-invite v1 — convite p/ organização PJ. Link opaco de
// aceite com expiração; papel (`role`) limitado ao vocabulário
// OWNER/ADMIN/FINANCE/MEMBER.
export const organizationInviteTemplate: EmailTemplateDef = {
  name: 'organization-invite',
  version: 'v1',
  requiredVars: ['orgName', 'role', 'actionUrl', 'expiresInDays'],
  render(vars: TemplateVars) {
    const orgName = str(vars, 'orgName');
    const role = str(vars, 'role');
    const actionUrl = str(vars, 'actionUrl', '#');
    const expires = str(vars, 'expiresInDays');
    const subject = `Convite para ${orgName} — Aurum Bit`;
    const text =
      `Olá,\n\nVocê foi convidado(a) para a organização ${orgName} com o papel ${role}.\n\n` +
      `Aceite o convite (válido por ${expires} dias):\n${actionUrl}\n\nSe não reconhece este convite, ignore esta mensagem.\n— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Você foi convidado(a) para a organização <strong>${escapeHtml(orgName)}</strong> ` +
      `com o papel <strong>${escapeHtml(role)}</strong>.</p>` +
      `<p><a href="${escapeHtml(actionUrl)}">Aceitar convite</a> (válido por ${escapeHtml(expires)} dias).</p>` +
      `<p>Se não reconhece este convite, ignore esta mensagem.</p><p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
