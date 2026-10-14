import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// license-expiring v1 — aviso de vencimento (com janela de graça de 3d —
// PROJECT.md §1). Só chave mascarada.
export const licenseExpiringTemplate: EmailTemplateDef = {
  name: 'license-expiring',
  version: 'v1',
  requiredVars: ['keyMasked', 'expiresAt'],
  optionalVars: ['actionUrl'],
  render(vars: TemplateVars) {
    const keyMasked = str(vars, 'keyMasked');
    const expires = str(vars, 'expiresAt');
    const actionUrl = str(vars, 'actionUrl', '');
    const subject = 'Sua licença vence em breve — Aurum Bit';
    const text =
      `Olá,\n\nSua licença ${keyMasked} vence em ${expires}.\n` +
      `Renove para evitar interrupções (há 3 dias de tolerância após o vencimento).\n` +
      (actionUrl !== '' && actionUrl !== '—' ? `Renovar agora:\n${actionUrl}\n` : '') +
      `— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Sua licença <strong>${escapeHtml(keyMasked)}</strong> vence em ` +
      `<strong>${escapeHtml(expires)}</strong>.</p>` +
      `<p>Renove para evitar interrupções (há 3 dias de tolerância após o vencimento).</p>` +
      (actionUrl !== '' && actionUrl !== '—' ? `<p><a href="${escapeHtml(actionUrl)}">Renovar agora</a></p>` : '') +
      `<p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
