import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// subscription-cancelled v1 — cancelamento confirmado, com data de
// vigência restante e link opcional de reativação.
export const subscriptionCancelledTemplate: EmailTemplateDef = {
  name: 'subscription-cancelled',
  version: 'v1',
  requiredVars: ['planName', 'effectiveDate'],
  optionalVars: ['actionUrl'],
  render(vars: TemplateVars) {
    const plan = str(vars, 'planName');
    const effective = str(vars, 'effectiveDate');
    const actionUrl = str(vars, 'actionUrl', '');
    const subject = 'Assinatura cancelada — Aurum Bit';
    const text =
      `Olá,\n\nSua assinatura do plano ${plan} foi cancelada e permanece válida até ${effective}.\n` +
      (actionUrl !== '' && actionUrl !== '—' ? `Mudou de ideia? Reative aqui:\n${actionUrl}\n` : '') +
      `— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Sua assinatura do plano <strong>${escapeHtml(plan)}</strong> foi cancelada ` +
      `e permanece válida até <strong>${escapeHtml(effective)}</strong>.</p>` +
      (actionUrl !== '' && actionUrl !== '—' ? `<p><a href="${escapeHtml(actionUrl)}">Reativar assinatura</a></p>` : '') +
      `<p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
