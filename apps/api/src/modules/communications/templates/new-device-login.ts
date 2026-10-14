import { escapeHtml, str, type EmailTemplateDef, type TemplateVars } from './template.types';

// new-device-login v1 — alerta de segurança. `deviceHint` é genérico
// (ex. "Chrome · Windows"), nunca hardware cru; sem IP/geolocalização
// no corpo (PROJECT.md §4 — sinais ficam em memória/auditoria).
export const newDeviceLoginTemplate: EmailTemplateDef = {
  name: 'new-device-login',
  version: 'v1',
  requiredVars: ['actionUrl', 'loginAt'],
  optionalVars: ['deviceHint'],
  render(vars: TemplateVars) {
    const actionUrl = str(vars, 'actionUrl', '#');
    const loginAt = str(vars, 'loginAt');
    const deviceHint = str(vars, 'deviceHint', 'um novo dispositivo');
    const subject = 'Novo acesso à sua conta — Aurum Bit';
    const text =
      `Olá,\n\nDetectamos um acesso à sua conta em ${loginAt} a partir de ${deviceHint}.\n\n` +
      `Se foi você, ignore esta mensagem. Caso contrário, revise sua conta imediatamente:\n${actionUrl}\n— Aurum Bit`;
    const html =
      `<p>Olá,</p><p>Detectamos um acesso à sua conta em <strong>${escapeHtml(loginAt)}</strong> ` +
      `a partir de <strong>${escapeHtml(deviceHint)}</strong>.</p>` +
      `<p>Se foi você, ignore esta mensagem. Caso contrário, ` +
      `<a href="${escapeHtml(actionUrl)}">revise sua conta imediatamente</a>.</p><p>— Aurum Bit</p>`;
    return { subject, html, text };
  },
};
