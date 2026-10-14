import { ConflictException } from '@nestjs/common';
import { CustomersService } from './customers.service';

// Fase 6 — GDPR no domínio customers (export JSON + anonymize).
// - anonymize nega 409 quando o perfil está ACTIVE com vigência em curso
//   (fonte da regra de vigência; o runbook orienta customers→auth).
// - sucesso: apaga nome/e-mail/vigência, marca CANCELLED, remove memberships,
//   emite `customer.anonymized.v1` sem PII.
describe('Customers GDPR — export/anonymize', () => {
  const ID = 'identity-1';

  function seeded(): CustomersService {
    const svc = new CustomersService();
    svc.patchMe(ID, { name: 'Titular', email: 'Titular@Example.com' });
    svc.createOrganization(ID, { razaoSocial: 'Acme LTDA', cnpj: '12.345.678/0001-95' });
    svc.recordConsent(ID, {
      purpose: 'TERMS',
      version: 'v1',
      status: 'GRANTED',
      policyHash: 'pol-1',
    });
    return svc;
  }

  it('export devolve perfil + memberships + consents em JSON', () => {
    const svc = seeded();
    const data = svc.exportData(ID);
    expect(data.profile).toMatchObject({ kind: 'PF', identityId: ID });
    expect(data.memberships).toHaveLength(1);
    expect(data.memberships[0]).toMatchObject({ identityId: ID, role: 'OWNER', status: 'ACTIVE' });
    expect(data.consents).toHaveLength(1);
    // Serializável (portabilidade) e sem segredos além do necessário.
    const raw = JSON.stringify(data);
    expect(raw).toContain(ID);
    expect(raw).not.toContain('password');
  });

  it('anonymize com ACTIVE + vigência em curso → 409', () => {
    const svc = seeded();
    const me = svc.getMe(ID);
    me.status = 'ACTIVE';
    me.vigenciaInicio = new Date(Date.now() - 86400000);
    me.vigenciaFim = new Date(Date.now() + 30 * 86400000);
    expect(() => svc.anonymize(ID)).toThrow(ConflictException);
    // Nada foi apagado pela tentativa negada.
    expect(svc.getMe(ID).email).toBe('titular@example.com');
  });

  it('anonymize com vigência expirada → apaga PII, cancela e remove vínculos', () => {
    const svc = seeded();
    const me = svc.getMe(ID);
    me.status = 'ACTIVE';
    me.vigenciaInicio = new Date(Date.now() - 60 * 86400000);
    me.vigenciaFim = new Date(Date.now() - 86400000); // expirada

    const out = svc.anonymize(ID);
    expect(out.name).toBe('ANONYMIZED');
    expect(out.email).toBe(`anon_${out.id}@anonymized.local`);
    expect(out.status).toBe('CANCELLED');
    expect(out.vigenciaInicio).toBeNull();
    expect(out.vigenciaFim).toBeNull();
    // Vínculos do titular removidos (export não exige membership ativa — leitura própria).
    for (const m of svc.exportData(ID).memberships) {
      expect(m.status).toBe('REMOVED');
    }
  });

  it('anonymize sem perfil PF → 404', () => {
    const svc = new CustomersService();
    expect(() => svc.anonymize('inexistente')).toThrow();
  });
});
