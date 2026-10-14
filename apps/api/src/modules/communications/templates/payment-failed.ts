import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// payment-failed v1 — cobrança não aprovada. Link opaco p/ retentativa;
// sem dados do meio de pagamento.
export const paymentFailedTemplate: EmailTemplateDef = {
  name: 'payment-failed',
  version: 'v1',
  requiredVars: ['referenceCode'],
  optionalVars: ['actionUrl', 'reasonCode'],
  render(vars: TemplateVars) {
    const ref = str(vars, 'referenceCode');
    const actionUrl = str(vars, 'actionUrl', '');
    const reason = str(vars, 'reasonCode', '');
    const subject = 'Não conseguimos processar seu pagamento — Aurum Bit';
    const text =
      `Olá,\n\nNão conseguimos processar o pagamento ${ref}` +
      (reason !== '' && reason !== '—' ? ` (motivo: ${reason})` : '') +
      `.\n` +
      (actionUrl !== '' && actionUrl !== '—' ? `Tente novamente:\n${actionUrl}\n` : '') +
      `Se precisar de ajuda, fale com o suporte.\n— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Não conseguimos processar o pagamento <strong>${escapeHtml(ref)}</strong>` +
      (reason !== '' && reason !== '—' ? ` (motivo: ${escapeHtml(reason)})` : '') +
      `.</p>` +
      (actionUrl !== '' && actionUrl !== '—' ? `<p><a href="${escapeHtml(actionUrl)}">Tentar novamente</a></p>` : '') +
      `<p>Se precisar de ajuda, fale com o suporte.</p><p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
