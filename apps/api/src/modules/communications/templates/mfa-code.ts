import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// mfa-code v1 — código de verificação. O `code` é segredo transitório:
// trafega no job em memória e é REDIGIDO antes de persistir
// (`EmailMessage.variables` guarda `[REDACTED]` — ver email.service).
export const mfaCodeTemplate: EmailTemplateDef = {
  name: 'mfa-code',
  version: 'v1',
  requiredVars: ['code', 'expiresInMinutes'],
  render(vars: TemplateVars) {
    const code = str(vars, 'code');
    const expires = str(vars, 'expiresInMinutes');
    const subject = 'Seu código de verificação — Aurum Bit';
    const text =
      `Olá,\n\nSeu código de verificação é:\n${code}\n\nVálido por ${expires} minutos. Nunca compartilhe este código.\n— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Seu código de verificação é:</p>` +
      `<p style="font-size:24px;letter-spacing:4px"><strong>${escapeHtml(code)}</strong></p>` +
      `<p>Válido por ${escapeHtml(expires)} minutos. Nunca compartilhe este código.</p><p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
