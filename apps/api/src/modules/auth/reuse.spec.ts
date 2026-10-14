import { InMemoryAuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { AuthError } from './auth.types';
import { decryptSecret, deriveEncKey, sha256Hex, totpCode } from './crypto';

const SECRET = 'test-jwt-secret-32chars-minimum!!';

function makeService(repo = new InMemoryAuthRepository()) {
  return { repo, svc: new AuthService(repo, { jwtSecret: SECRET }) };
}

const CONSENTS = [
  { type: 'TERMS', version: '2026-10-10.v1' },
  { type: 'PRIVACY', version: '2026-10-10.v1' },
];

async function registered(svc: AuthService, email = 'user@example.com') {
  await svc.register({ email, password: 'strong-pass-01', consents: CONSENTS });
  const repo = (svc as any).repo as InMemoryAuthRepository;
  const identity = await repo.findIdentityByEmailNorm(email);
  const lastPayload = repo.outbox[repo.outbox.length - 1].payload as Record<string, unknown>;
  const raw = String(lastPayload['verificationToken']);
  return { identity: identity!, raw };
}

describe('auth service (fluxos Fase 2)', () => {
  it('register exige consents TERMS+PRIVACY', async () => {
    const { svc } = makeService();
    await expect(svc.register({ email: 'a@b.co', password: 'strong-pass-01', consents: [] })).rejects.toMatchObject({ code: 'CONSENTS_REQUIRED' });
  });

  it('register → verify → login emite access+refresh', async () => {
    const { repo, svc } = makeService();
    const { identity, raw } = await registered(svc);
    expect(identity.status).toBe('PENDING_VERIFICATION');
    await svc.verifyEmail(raw);
    expect((await repo.findIdentityById(identity.id))!.status).toBe('ACTIVE');
    const login: any = await svc.login({ email: 'user@example.com', password: 'strong-pass-01' });
    expect(login.accessToken).toBeTruthy();
    expect(login.refreshToken).toBeTruthy();
    expect(login.expiresIn).toBe(900);
    expect(repo.outbox.map((o) => o.type)).toEqual(
      expect.arrayContaining(['auth.identity.created.v1', 'auth.email.verified.v1']),
    );
  });

  it('resend/forgot anti-enumeração: inexistente retorna ok genérico', async () => {
    const { repo, svc } = makeService();
    await expect(svc.resendVerification('ghost@example.com')).resolves.toEqual({ ok: true });
    await expect(svc.forgotPassword('ghost@example.com')).resolves.toEqual({ ok: true });
    expect(repo.outbox).toHaveLength(0);
  });

  it('login: senha errada 5x trava a conta (lockout)', async () => {
    const { repo, svc } = makeService();
    const { raw } = await registered(svc);
    await svc.verifyEmail(raw);
    for (let i = 0; i < 5; i++) {
      await expect(svc.login({ email: 'user@example.com', password: 'wrong-pass-00' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    const id = (await repo.findIdentityByEmailNorm('user@example.com'))!;
    expect(id.status).toBe('LOCKED');
    expect(id.lockedUntil).toBeTruthy();
    await expect(svc.login({ email: 'user@example.com', password: 'strong-pass-01' })).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });

  it('refresh: rotação emite novo token; reuso do antigo revoga a família', async () => {
    const { repo, svc } = makeService();
    const { raw } = await registered(svc);
    await svc.verifyEmail(raw);
    const first: any = await svc.login({ email: 'user@example.com', password: 'strong-pass-01' });
    const second: any = await svc.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    // Reuso do token já rotacionado → revoga família.
    await expect(svc.refresh(first.refreshToken)).rejects.toMatchObject({ code: 'REUSE_DETECTED' });
    // Token novo (da família revogada) também morre.
    await expect(svc.refresh(second.refreshToken)).rejects.toBeInstanceOf(AuthError);
    const sessions = await repo.listSessionsByIdentity((await repo.findIdentityByEmailNorm('user@example.com'))!.id);
    expect(sessions.every((s) => s.status === 'REVOKED')).toBe(true);
    expect(repo.outbox.map((o) => o.type)).toContain('auth.session.revoked.v1');
  });

  it('forgot/reset: 60min hash-only, single-use, revoga sessões', async () => {
    const { repo, svc } = makeService();
    const { raw } = await registered(svc, 'reset@example.com');
    await svc.verifyEmail(raw);
    const login: any = await svc.login({ email: 'reset@example.com', password: 'strong-pass-01' });
    await svc.forgotPassword('reset@example.com');
    const cred = (await repo.findCredentialByRecoveryHash('x')) ?? null;
    expect(cred).toBeNull(); // hash desconhecido não acha nada
    const outboxReset = repo.outbox.find((o) => o.type === 'auth.password.reset_requested.v1')!;
    const token = String((outboxReset.payload as Record<string, unknown>)['recoveryToken']);
    const stored = await repo.findCredentialByRecoveryHash(sha256Hex(token));
    expect(stored).toBeTruthy(); // DB guarda hash, nunca plaintext
    expect(((outboxReset.payload as Record<string, unknown>) as any).ttlMin).toBe(60);
    await svc.resetPassword(token, 'brand-new-pass-2');
    // single-use: segundo uso falha
    await expect(svc.resetPassword(token, 'brand-new-pass-3')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    // sessões antigas revogadas
    await expect(svc.refresh(login.refreshToken)).rejects.toBeInstanceOf(AuthError);
    // nova senha funciona
    const again: any = await svc.login({ email: 'reset@example.com', password: 'brand-new-pass-2' });
    expect(again.accessToken).toBeTruthy();
  });

  it('recovery expirado é rejeitado', async () => {
    const { repo, svc } = makeService();
    const { raw } = await registered(svc, 'exp@example.com');
    await svc.verifyEmail(raw);
    await svc.forgotPassword('exp@example.com');
    const outboxReset = repo.outbox.find((o) => o.type === 'auth.password.reset_requested.v1')!;
    const token = String((outboxReset.payload as Record<string, unknown>)['recoveryToken']);
    const id = (await repo.findIdentityByEmailNorm('exp@example.com'))!;
    await repo.updateCredential(id.id, { recoveryExpiresAt: new Date(Date.now() - 1000) });
    await expect(svc.resetPassword(token, 'another-pass-01')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('change-password valida atual e mantém só a sessão corrente', async () => {
    const { svc } = makeService();
    const { raw } = await registered(svc, 'chg@example.com');
    await svc.verifyEmail(raw);
    const a: any = await svc.login({ email: 'chg@example.com', password: 'strong-pass-01' });
    const claims = svc.verifyAccess(a.accessToken);
    await expect(svc.changePassword(claims.identityId, 'wrong-current', 'new-pass-word-1')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await svc.changePassword(claims.identityId, 'strong-pass-01', 'new-pass-word-1', claims.sessionId);
    const again: any = await svc.login({ email: 'chg@example.com', password: 'new-pass-word-1' });
    expect(again.accessToken).toBeTruthy();
  });

  it('mfa: enroll → verify → login exige step-up', async () => {
    const { repo, svc } = makeService();
    const { raw } = await registered(svc, 'mfa@example.com');
    await svc.verifyEmail(raw);
    const before: any = await svc.login({ email: 'mfa@example.com', password: 'strong-pass-01' });
    const claims = svc.verifyAccess(before.accessToken);
    const enroll = await svc.mfaEnroll(claims.identityId);
    expect(enroll.secret.length).toBeGreaterThan(15);
    expect(enroll.otpauthUrl.startsWith('otpauth://totp/')).toBe(true);
    await expect(svc.mfaVerifyEnrollment(claims.identityId, '000000')).rejects.toMatchObject({ code: 'MFA_INVALID_CODE' });
    // Código real a partir do segredo cifrado (como o app autenticador faria).
    const cred = (await repo.findCredentialByIdentityId(claims.identityId))!;
    const plain = decryptSecret(cred.mfaSecretEnc!, deriveEncKey('aurum-mfa-v1', SECRET));
    await svc.mfaVerifyEnrollment(claims.identityId, totpCode(plain));
    expect((await repo.findIdentityById(claims.identityId))!.mfaEnabled).toBe(true);
    // Próximo login retorna ticket MFA em vez de sessão.
    const challenged: any = await svc.login({ email: 'mfa@example.com', password: 'strong-pass-01' });
    expect(challenged.mfaRequired).toBe(true);
    const done: any = await svc.mfaCompleteLogin(challenged.mfaTicket, totpCode(plain));
    expect(done.accessToken).toBeTruthy();
  });
});
