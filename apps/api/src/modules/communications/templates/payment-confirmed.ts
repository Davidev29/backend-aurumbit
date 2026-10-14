import { escapeHtml, formatAmount, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// payment-confirmed v1 — recibo. Só referência opaca + valor/moeda;
// sem dados do meio de pagamento.
export const paymentConfirmedTemplate: EmailTemplateDef = {
  name: 'payment-confirmed',
  version: 'v1',
  requiredVars: ['referenceCode'],
  optionalVars: ['amountCents', 'currency', 'receiptUrl'],
  render(vars: TemplateVars) {
    const ref = str(vars, 'referenceCode');
    const amount = formatAmount(vars.amountCents, vars.currency);
    const receiptUrl = str(vars, 'receiptUrl', '');
    const subject = 'Pagamento confirmado — Aurum Bit';
    const text =
      `Olá,\n\nConfirmamos o recebimento do pagamento ${ref} no valor de ${amount}.\n` +
      (receiptUrl !== '' && receiptUrl !== '—' ? `Recibo:\n${receiptUrl}\n` : '') +
      `Obrigado por usar a Aurum Bit.\n— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Confirmamos o recebimento do pagamento <strong>${escapeHtml(ref)}</strong> ` +
      `no valor de <strong>${escapeHtml(amount)}</strong>.</p>` +
      (receiptUrl !== '' && receiptUrl !== '—' ? `<p><a href="${escapeHtml(receiptUrl)}">Ver recibo</a></p>` : '') +
      `<p>Obrigado por usar a Aurum Bit.</p><p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
