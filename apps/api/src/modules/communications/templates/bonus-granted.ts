import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// bonus-granted v1 — benefício concedido (ex. máquinas extras, licença
// vitalícia). Só rótulo do benefício + vigência; sem justificativa
// interna nem dados do concedente.
export const bonusGrantedTemplate: EmailTemplateDef = {
  name: 'bonus-granted',
  version: 'v1',
  requiredVars: ['benefitLabel'],
  optionalVars: ['expiresAt', 'actionUrl'],
  render(vars: TemplateVars) {
    const benefit = str(vars, 'benefitLabel');
    const expires = str(vars, 'expiresAt', '');
    const actionUrl = str(vars, 'actionUrl', '');
    const subject = 'Você recebeu um benefício — Aurum Bit';
    const text =
      `Olá,\n\nVocê recebeu um benefício: ${benefit}` +
      (expires !== '' && expires !== '—' ? ` (válido até ${expires})` : ' (sem expiração)') +
      `.\n` +
      (actionUrl !== '' && actionUrl !== '—' ? `Ver detalhes:\n${actionUrl}\n` : '') +
      `— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Você recebeu um benefício: <strong>${escapeHtml(benefit)}</strong>` +
      (expires !== '' && expires !== '—' ? ` (válido até ${escapeHtml(expires)})` : ' (sem expiração)') +
      `.</p>` +
      (actionUrl !== '' && actionUrl !== '—' ? `<p><a href="${escapeHtml(actionUrl)}">Ver detalhes</a></p>` : '') +
      `<p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
