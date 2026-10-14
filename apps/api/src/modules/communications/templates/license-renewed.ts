import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// license-renewed v1 — renovação confirmada (nova chave; continuidade
// sem lacuna quando renovada em graça — PROJECT.md §1). Só mascarada.
export const licenseRenewedTemplate: EmailTemplateDef = {
  name: 'license-renewed',
  version: 'v1',
  requiredVars: ['keyMasked', 'expiresAt'],
  optionalVars: ['actionUrl'],
  render(vars: TemplateVars) {
    const keyMasked = str(vars, 'keyMasked');
    const expires = str(vars, 'expiresAt');
    const actionUrl = str(vars, 'actionUrl', '');
    const subject = 'Licença renovada — Aurum Bit';
    const text =
      `Olá,\n\nSua licença foi renovada (${keyMasked}) e agora é válida até ${expires}.\n` +
      (actionUrl !== '' && actionUrl !== '—' ? `Acesse o produto:\n${actionUrl}\n` : '') +
      `— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Sua licença foi renovada (<strong>${escapeHtml(keyMasked)}</strong>) ` +
      `e agora é válida até <strong>${escapeHtml(expires)}</strong>.</p>` +
      (actionUrl !== '' && actionUrl !== '—' ? `<p><a href="${escapeHtml(actionUrl)}">Acessar o produto</a></p>` : '') +
      `<p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
