import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// payment-overdue v1 — cobrança em atraso. Só referência + vencimento;
// sem valores sensíveis além do necessário à cobrança.
export const paymentOverdueTemplate: EmailTemplateDef = {
  name: 'payment-overdue',
  version: 'v1',
  requiredVars: ['referenceCode', 'dueDate'],
  optionalVars: ['actionUrl'],
  render(vars: TemplateVars) {
    const ref = str(vars, 'referenceCode');
    const due = str(vars, 'dueDate');
    const actionUrl = str(vars, 'actionUrl', '');
    const subject = 'Pagamento em atraso — Aurum Bit';
    const text =
      `Olá,\n\nO pagamento ${ref} está em atraso desde ${due}.\n` +
      (actionUrl !== '' && actionUrl !== '—' ? `Regularize aqui:\n${actionUrl}\n` : '') +
      `Evite a suspensão do serviço mantendo seus pagamentos em dia.\n— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>O pagamento <strong>${escapeHtml(ref)}</strong> está em atraso desde ` +
      `<strong>${escapeHtml(due)}</strong>.</p>` +
      (actionUrl !== '' && actionUrl !== '—' ? `<p><a href="${escapeHtml(actionUrl)}">Regularizar agora</a></p>` : '') +
      `<p>Evite a suspensão do serviço mantendo seus pagamentos em dia.</p><p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
