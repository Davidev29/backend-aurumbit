import { AuthService } from './auth.service';
import { InMemoryAuthRepository } from './auth.repository';
import { AuthError } from './auth.types';

// Fase 6 — GDPR no domínio auth (stub→real mínimo).
// - export: JSON portável, e-mail mascarado, SEM passwordHash/hashes de token/segredo MFA.
// - anonymize: revoga sessões, limpa credencial, apaga e-mail, marca DELETED,
//   emite outbox sem PII. O 409 `ACTIVE com vigência` vive no domínio customers
//   (fonte da vigência); a ordem canônica é customers→auth (ver runbook).
describe('Auth GDPR — export/anonymize', () => {
  const SECRET = 'test-only-secret-min-16-chars';
  const EMAIL = 'titular@example.com';
  const PASSWORD = 'S3nha-forte-99';

  async function registeredLogged(): Promise<{ svc: AuthService; repo: InMemoryAuthRepository; id: string }> {
    const repo = new InMemoryAuthRepository();
    const svc = new AuthService(repo, { jwtSecret: SECRET });
    await svc.register({
      email: EMAIL,
      password: PASSWORD,
      consents: [
        { type: 'TERMS', version: 'v1' },
        { type: 'PRIVACY', version: 'v1' },
      ],
    });
    const created = repo.outbox.find((o) => o.type === 'auth.identity.created.v1');
    const raw = (created?.payload as Record<string, unknown>)?.verificationToken as string;
    expect(typeof raw).toBe('string');
    await svc.verifyEmail(raw);
    const login = await svc.login({ email: EMAIL, password: PASSWORD });
    if ('mfaRequired' in login) throw new Error('MFA inesperado no fluxo de teste');
    const me = await repo.findIdentityByEmailNorm('titular@example.com');
    return { svc, repo, id: me!.id };
  }

  it('export devolve JSON portável com e-mail mascarado e sem segredos', async () => {
    const { svc, repo, id } = await registeredLogged();
    const data = await svc.exportData(id);
    expect(data.identity.id).toBe(id);
    expect(data.identity.emailMasked).toBe('t***@example.com');
    expect(data.identity.status).toBe('ACTIVE');
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0]).toEqual({
      id: expect.any(String),
      deviceLabel: null,
      status: 'ACTIVE',
      expiresAt: expect.any(Date),
      lastSeenAt: expect.any(Date),
    });
    expect(data.consents).toEqual([
      { type: 'TERMS', version: 'v1', acceptedAt: expect.any(Date) },
      { type: 'PRIVACY', version: 'v1', acceptedAt: expect.any(Date) },
    ]);
    const raw = JSON.stringify(data);
    expect(raw).not.toContain(EMAIL);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('tokenHash');
    expect(raw).not.toContain('mfaSecretEnc');
    // Consistência com o repositório: 2 aceites versionados.
    expect(await repo.listConsentsByIdentity(id)).toHaveLength(2);
  });

  it('export de identidade inexistente/anonimizada → 404', async () => {
    const repo = new InMemoryAuthRepository();
    const svc = new AuthService(repo, { jwtSecret: SECRET });
    await expect(svc.exportData('nao-existe')).rejects.toMatchObject({ status: 404 });
  });

  it('anonymize revoga sessões, limpa credencial, apaga e-mail e emite outbox sem PII', async () => {
    const { svc, repo, id } = await registeredLogged();
    const before = await repo.findIdentityById(id);
    expect(before!.emailNorm).toBe('titular@example.com');

    await svc.anonymize(id);

    const identity = await repo.findIdentityById(id);
    expect(identity!.status).toBe('DELETED');
    expect(identity!.emailNorm).toBe(`anon_${id}@anonymized.local`);
    expect(identity!.emailDisplay).toBe(`anon_${id}@anonymized.local`);
    expect(identity!.mfaEnabled).toBe(false);

    const sessions = await repo.listSessionsByIdentity(id);
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect(s.status).toBe('REVOKED');
      expect(s.revokedReason).toBe('GDPR_ERASURE');
    }

    const cred = await repo.findCredentialByIdentityId(id);
    expect(cred!.passwordHash).toBe('');
    expect(cred!.recoveryHash).toBeNull();
    expect(cred!.mfaSecretEnc).toBeNull();

    const evt = repo.outbox.find((o) => o.type === 'auth.identity.anonymized.v1');
    expect(evt).toBeDefined();
    expect(evt!.payload).toEqual({ identityId: id });
    expect(JSON.stringify(repo.outbox)).not.toContain(EMAIL);

    // Pós-apagamento: login cai no 401 genérico (anti-enumeração) e export em 404.
    await expect(svc.login({ email: EMAIL, password: PASSWORD })).rejects.toBeInstanceOf(AuthError);
    await expect(svc.exportData(id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.anonymize(id)).rejects.toMatchObject({ status: 404 });
  });
});
