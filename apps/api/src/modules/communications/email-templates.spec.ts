import {
  MissingTemplateVarError,
  OUT_OF_SCOPE_TEMPLATES,
  OutOfScopeTemplateError,
  TEMPLATE_NAMES,
  UnknownTemplateError,
  UnsupportedTemplateVersionError,
  getTemplate,
  renderTemplate,
} from './email-templates';

const EXPECTED_14 = [
  'verify-email',
  'reset-password',
  'new-device-login',
  'account-blocked',
  'mfa-code',
  'organization-invite',
  'payment-confirmed',
  'payment-failed',
  'payment-overdue',
  'subscription-cancelled',
  'license-issued',
  'license-expiring',
  'license-renewed',
  'bonus-granted',
];

const MINIMAL_VARS: Record<string, Record<string, unknown>> = {
  'verify-email': { actionUrl: 'https://app.example/verify?t=abc', expiresInMinutes: 30 },
  'reset-password': { actionUrl: 'https://app.example/reset?t=abc', expiresInMinutes: 60 },
  'new-device-login': { actionUrl: 'https://app.example/security', loginAt: '2026-10-10T12:00:00Z', deviceHint: 'Chrome · Windows' },
  'account-blocked': { reasonCode: 'LOCKOUT', supportUrl: 'https://app.example/suporte' },
  'mfa-code': { code: '482916', expiresInMinutes: 10 },
  'organization-invite': { orgName: 'Acme Ltda', role: 'MEMBER', actionUrl: 'https://app.example/invite?t=abc', expiresInDays: 7 },
  'payment-confirmed': { referenceCode: 'pay_123', amountCents: 9990, currency: 'BRL', receiptUrl: 'https://app.example/r/pay_123' },
  'payment-failed': { referenceCode: 'pay_124', actionUrl: 'https://app.example/pagar/pay_124', reasonCode: 'CARD_DECLINED' },
  'payment-overdue': { referenceCode: 'pay_125', dueDate: '2026-10-05', actionUrl: 'https://app.example/pagar/pay_125' },
  'subscription-cancelled': { planName: 'Pro mensal', effectiveDate: '2026-11-10', actionUrl: 'https://app.example/reativar' },
  'license-issued': { keyMasked: 'AURUM-••••-••••-AB12', planName: 'Pro', expiresAt: '2027-10-10', actionUrl: 'https://app.example/app' },
  'license-expiring': { keyMasked: 'AURUM-••••-••••-AB12', expiresAt: '2026-10-15', actionUrl: 'https://app.example/renovar' },
  'license-renewed': { keyMasked: 'AURUM-••••-••••-CD34', expiresAt: '2027-10-15' },
  'bonus-granted': { benefitLabel: '+5 máquinas', expiresAt: '2027-10-10' },
};

describe('email-templates (escopo real, PROJECT.md §6)', () => {
  it('expõe exatamente os 14 templates do escopo real', () => {
    expect([...TEMPLATE_NAMES].sort()).toEqual([...EXPECTED_14].sort());
    expect(TEMPLATE_NAMES).toHaveLength(14);
  });

  it.each(EXPECTED_14)('%s renderiza v1 com vars mínimas (subject/html/text)', (name) => {
    const def = getTemplate(name, 'v1');
    expect(def.version).toBe('v1');
    const out = renderTemplate(name, 'v1', MINIMAL_VARS[name]);
    expect(out.subject.length).toBeGreaterThan(0);
    expect(out.html).toContain('<p>');
    expect(out.text.length).toBeGreaterThan(0);
  });

  it('nunca vaza chave completa: license-issued só exibe a máscara', () => {
    const fullKey = 'AURUM-ABCD-EFGH-AB12';
    const out = renderTemplate('license-issued', 'v1', {
      keyMasked: 'AURUM-••••-••••-AB12',
      expiresAt: '2027-10-10',
    });
    expect(out.html).toContain('AB12');
    expect(out.html).not.toContain(fullKey);
    expect(out.text).not.toContain(fullKey);
  });

  it('escapa interpolação em HTML (vars de produtores nunca confiam)', () => {
    const out = renderTemplate('verify-email', 'v1', {
      actionUrl: 'https://x.example/"><script>alert(1)</script>',
      expiresInMinutes: 30,
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('rejeita o trio wallet/crypto fora de escopo com erro explícito', () => {
    expect([...OUT_OF_SCOPE_TEMPLATES].sort()).toEqual(['deposit-confirmed', 'order-filled', 'withdrawal-confirm'].sort());
    for (const name of OUT_OF_SCOPE_TEMPLATES) {
      expect(() => getTemplate(name, 'v1')).toThrow(OutOfScopeTemplateError);
    }
  });

  it('rejeita template desconhecido e versão não suportada', () => {
    expect(() => getTemplate('nao-existe', 'v1')).toThrow(UnknownTemplateError);
    expect(() => getTemplate('verify-email', 'v2')).toThrow(UnsupportedTemplateVersionError);
  });

  it('rejeita vars obrigatórias ausentes (poison → DLQ)', () => {
    expect(() => renderTemplate('verify-email', 'v1', { actionUrl: 'https://x.example' })).toThrow(
      MissingTemplateVarError,
    );
  });
});
