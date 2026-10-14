import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// license-issued v1 — licença emitida. Só a chave MASCARADA (`keyMasked`
// = `AURUM-••••-••••-AB12`); plaintext/hash nunca entram no e-mail
// (PROJECT.md §2). A chave completa é entregue uma única vez pelo fluxo
// de emissão, nunca por e-mail.
export const licenseIssuedTemplate: EmailTemplateDef = {
  name: 'license-issued',
  version: 'v1',
  requiredVars: ['keyMasked', 'expiresAt'],
  optionalVars: ['planName', 'actionUrl'],
  render(vars: TemplateVars) {
    const keyMasked = str(vars, 'keyMasked');
    const expires = str(vars, 'expiresAt');
    const plan = str(vars, 'planName', '');
    const actionUrl = str(vars, 'actionUrl', '');
    const subject = 'Sua licença Aurum Bit está ativa';
    const text =
      `Olá,\n\nSua licença ${keyMasked}` +
      (plan !== '' && plan !== '—' ? ` (plano ${plan})` : '') +
      ` está ativa e é válida até ${expires}.\n` +
      (actionUrl !== '' && actionUrl !== '—' ? `Acesse o produto:\n${actionUrl}\n` : '') +
      `Guarde sua chave de ativação em local seguro.\n— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Sua licença <strong>${escapeHtml(keyMasked)}</strong>` +
      (plan !== '' && plan !== '—' ? ` (plano ${escapeHtml(plan)})` : '') +
      ` está ativa e é válida até <strong>${escapeHtml(expires)}</strong>.</p>` +
      (actionUrl !== '' && actionUrl !== '—' ? `<p><a href="${escapeHtml(actionUrl)}">Acessar o produto</a></p>` : '') +
      `<p>Guarde sua chave de ativação em local seguro.</p><p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
