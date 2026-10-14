import { AuditService } from './audit.service';
import { sanitizeAuditMetadata } from './audit-record';

// Fase 6 — Segurança final.
// - Trilha append-only: o serviço expõe SÓ emit/list/listByEntity
//   (sem update/delete); o schema `prisma/audit` documenta a proibição.
// - Sem PII: metadata passa por allowlist estrita (keyMasked/device_hash +
//   campos operacionais); e-mail, CPF, chave crua, IP cru, appInstanceId,
//   hashes de busca e tokens são descartados antes de persistir.
describe('Audit — append-only (sem UPDATE/DELETE)', () => {
  it('expõe só a superfície de escrita única + leitura', () => {
    const methods = Object.getOwnPropertyNames(AuditService.prototype).filter(
      (m) => m !== 'constructor',
    );
    expect(methods.sort()).toEqual(['emit', 'list', 'listByEntity']);
  });

  it('não possui nenhum método de mutação/remoção', () => {
    const proto = AuditService.prototype as unknown as Record<string, unknown>;
    for (const banned of ['update', 'delete', 'remove', 'patch', 'upsert', 'save']) {
      expect(proto[banned]).toBeUndefined();
    }
  });
});

describe('Audit — metadata sem PII (allowlist)', () => {
  it('descarta e-mail/cpf/chave crua/ip cru/appInstanceId/token/senha', () => {
    const clean = sanitizeAuditMetadata({
      keyMasked: 'AURUM-••••-••••-AB12',
      device_hash: 'abc123',
      reason: 'suporte',
      months: 12,
      eventId: 'evt-1',
      actorId: 'u-1',
      orgId: 'o-1',
      amountCents: 1000,
      kind: 'INCOME',
      // PII / segredos — tudo deve cair:
      email: 'user@example.com',
      cpf: '123.456.789-09',
      licenseKey: 'AURUM-AAAA-BBBB-CC12',
      key_hash: 'deadbeef',
      key_enc: 'enc...',
      ip: '192.168.10.77',
      appInstanceId: 'inst-1',
      app_instance_id: 'inst-1',
      token: 'raw-token',
      password: 'segredo',
      city: 'São Paulo',
      country: 'BR',
    });
    expect(clean).toEqual({
      keyMasked: 'AURUM-••••-••••-AB12',
      device_hash: 'abc123',
      reason: 'suporte',
      months: 12,
      eventId: 'evt-1',
      actorId: 'u-1',
      orgId: 'o-1',
      amountCents: 1000,
      kind: 'INCOME',
    });
  });

  it('emit() persiste só metadata sanitizada', () => {
    const audit = new AuditService();
    const ev = audit.emit({
      actorId: 'u-1',
      action: 'license.reveal',
      entity: 'license',
      entityId: 'lic-1',
      metadata: {
        keyMasked: 'AURUM-••••-••••-AB12',
        reason: 'suporte',
        email: 'user@example.com',
        ip: '10.0.0.1',
      },
    });
    expect(ev.metadata).toEqual({
      keyMasked: 'AURUM-••••-••••-AB12',
      reason: 'suporte',
    });
    expect(JSON.stringify(audit.list())).not.toContain('user@example.com');
  });

  it('list() devolve cópias (mutação externa não contamina a trilha)', () => {
    const audit = new AuditService();
    audit.emit({ action: 'device.link', entity: 'license', metadata: { reason: 'x' } });
    const [first] = audit.list();
    (first.metadata as Record<string, unknown>).reason = 'adulterado';
    expect(audit.list()[0].metadata).toEqual({ reason: 'x' });
  });
});
