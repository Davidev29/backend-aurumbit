import { validateEnv } from '../../config/env.schema';
import { JwtService } from '../../common/auth/jwt.service';
import { __setSecurityEventPoolForTests } from '../audit/security-events';
import { InMemoryAuthRepository, PgAuthRepository } from './auth.repository';
import { assertMfaEncKeyConfig, AuthService, ROTATION_GRACE_MS } from './auth.service';
import { AuthError } from './auth.types';
import { decryptSecret, deriveEncKey, encryptSecret, sha256Hex, totpCode } from './crypto';

// ---------------------------------------------------------------------------
// Correções D2-1..D2-4: concorrência (o teste sequencial de reuse.spec.ts não
// pega race), fail-fast de chave MFA e rejeição de placeholder.
// ---------------------------------------------------------------------------

const SECRET = 'test-jwt-secret-32chars-minimum!!';
const MFA_LABEL = 'aurum-mfa-v1'; // NEVER mudar (ver auth.service.ts)

const CONSENTS = [
  { type: 'TERMS', version: '2026-10-10.v1' },
  { type: 'PRIVACY', version: '2026-10-10.v1' },
];

function makeService(repo = new InMemoryAuthRepository()) {
  return { repo, svc: new AuthService(repo, { jwtSecret: SECRET }) };
}

async function readyIdentity(svc: AuthService, email: string) {
  await svc.register({ email, password: 'strong-pass-01', consents: CONSENTS });
  const repo = (svc as any).repo as InMemoryAuthRepository;
  const identity = (await repo.findIdentityByEmailNorm(email))!;
  const raw = String((repo.outbox[repo.outbox.length - 1].payload as Record<string, unknown>)['verificationToken']);
  await svc.verifyEmail(raw);
  return { repo, identity };
}

async function loggedIn(svc: AuthService, email: string) {
  const { repo, identity } = await readyIdentity(svc, email);
  const login: any = await svc.login({ email, password: 'strong-pass-01' });
  return { repo, identity, login };
}

function activeTokens(repo: InMemoryAuthRepository): Array<{ id: string; familyId: string }> {
  return [...repo.refreshTokens.values()].filter((t) => t.status === 'ACTIVE').map((t) => ({ id: t.id, familyId: t.familyId }));
}

/**
 * Captura os eventos de segurança (fire-and-forget) num pool fake — permite
 * provar que a corrida benigna NÃO emite o evento de reuso (REUSE_DETECTED).
 */
function captureSecurityEvents() {
  const calls: Array<{ type: string; meta: string }> = [];
  const pool = {
    query: jest.fn(async (_sql: string, params?: unknown[]) => {
      calls.push({ type: String(params?.[0]), meta: String(params?.[4]) });
      return { rows: [], rowCount: 1 };
    }),
  };
  __setSecurityEventPoolForTests(pool);
  return { calls };
}

// ===========================================================================
// D2-1 — refresh rotation não atômica
// ===========================================================================

describe('D2-1 rotação de refresh token é atômica (CAS)', () => {
  it('dois refresh() concorrentes com o MESMO token emitem no máximo 1 token filho', async () => {
    const { repo, svc } = makeService();
    const { login } = await loggedIn(svc, 'race@example.com');

    // Espia a EMISSÃO (o login inicial já consumiu 1 chamada de createRefreshToken).
    const emitted: Array<{ tokenHash: string; activeAtInsert: number }> = [];
    const realCreate = repo.createRefreshToken.bind(repo);
    jest.spyOn(repo, 'createRefreshToken').mockImplementation(async (input) => {
      // Instantâneo SINCRÔNICO no momento da inserção: se já existisse outro
      // token ACTIVE na família, teríamos 2 refresh tokens válidos simultâneos —
      // exatamente o que a race produzia antes da correção.
      emitted.push({ tokenHash: input.tokenHash, activeAtInsert: activeTokens(repo).length });
      return realCreate(input);
    });

    const results = await Promise.allSettled([svc.refresh(login.refreshToken), svc.refresh(login.refreshToken)]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const errs = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    // A vulnerabilidade: 2children válidos na mesma família.
    expect(emitted).toHaveLength(1);
    // Invariante forte: nunca 2 tokens ACTIVE simultâneos na família.
    expect(Math.max(...emitted.map((e) => e.activeAtInsert), 0)).toBeLessThanOrEqual(1);
    // Nunca dois sucessos concorrentes.
    expect(ok.length).toBeLessThanOrEqual(1);
    // O perdedor da corrida recebe 401 seco (`INVALID_TOKEN`): dentro da janela
    // de graça é corrida benigna e ele NÃO revoga a família (self-DoS).
    expect(errs).toHaveLength(2 - ok.length);
    for (const e of errs) expect((e.reason as AuthError).code).toBe('INVALID_TOKEN');
  });

  it('depois da race a família NÃO é revogada: só o filho do vencedor fica ACTIVE', async () => {
    const { repo, svc, login } = await makeServiceAndLogin('race2@example.com');
    const revokeFamily = jest.spyOn(repo, 'revokeFamilySessions');

    const settled = await Promise.allSettled([svc.refresh(login.refreshToken), svc.refresh(login.refreshToken)]);

    // Antes, o perdedor disparava `revokeFamily` e derrubava o filho que o
    // vencedor acabou de emitir (self-DoS). Com a janela de graça a família
    // sobrevive: o perdedor só leva 401 e a sessão do vencedor continua viva.
    expect(revokeFamily).not.toHaveBeenCalled();
    const familyId = [...repo.refreshTokens.values()][0].familyId;
    const family = [...repo.refreshTokens.values()].filter((t) => t.familyId === familyId);
    expect(family.filter((t) => t.status === 'ACTIVE')).toHaveLength(1);
    const sessions = [...repo.sessions.values()].filter((s) => s.familyId === familyId);
    expect(sessions).toHaveLength(1);
    expect(sessions.every((s) => s.status === 'ACTIVE')).toBe(true);
    expect(repo.outbox.map((o) => o.type)).not.toContain('auth.session.revoked.v1');
    const loser = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((loser.reason as AuthError).code).toBe('INVALID_TOKEN');
  });

  it('SQL: o UPDATE de rotação carrega a guarda `AND status = ACTIVE` e devolve null no perdedor', async () => {
    // Pool fake STATEFUL (mesmo padrão de finance-automation.spec.ts:274-320):
    // emula a semântica do Postgres guided pela própria guarda presente no SQL.
    let row: Record<string, unknown> = {
      id: 'tok-1',
      session_id: 'ses-1',
      family_id: 'fam-1',
      token_hash: 'h1',
      parent_hash: null,
      status: 'ACTIVE',
      expires_at: new Date(Date.now() + 86_400_000),
      rotated_at: null,
      createdAt: new Date(),
    };
    const seen: string[] = [];
    const query = jest.fn(async (sqlText: string) => {
      seen.push(sqlText);
      if (sqlText.includes("SET status = 'ROTATED'")) {
        // Guarda ausente => o UPDATE rotacionaria duas vezes (o bug D2-1).
        expect(sqlText).toContain("WHERE id = $1 AND status = 'ACTIVE'");
        expect(sqlText).toContain('RETURNING *');
        if (row.status !== 'ACTIVE') return { rows: [], rowCount: 0 };
        row = { ...row, status: 'ROTATED', rotated_at: new Date() };
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const repo = new PgAuthRepository(undefined, { query } as never);

    const winner = await repo.rotateRefreshToken('tok-1', new Date());
    const loser = await repo.rotateRefreshToken('tok-1', new Date());

    expect(winner?.status).toBe('ROTATED');
    expect(loser).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    expect(seen[0]).toBe("UPDATE auth.refresh_tokens SET status = 'ROTATED', rotated_at = $2 WHERE id = $1 AND status = 'ACTIVE' RETURNING *");
  });
});

// ===========================================================================
// Janela de graça da rotação (self-DoS): a corrida benigna NÃO revoga a família
// ===========================================================================

describe('janela de graça da rotação de refresh (self-DoS)', () => {
  afterEach(() => {
    // Devolve o singleton da trilha de segurança ao estado lazy (sem pool).
    __setSecurityEventPoolForTests(undefined);
  });

  it('(a) perdedor DENTRO da janela: família preservada, sem REUSED e filho do vencedor segue válido', async () => {
    const { repo, svc, login } = await makeServiceAndLogin('grace@example.com');
    const audit = captureSecurityEvents();
    const revokeFamily = jest.spyOn(repo, 'revokeFamilySessions');
    const revokeTokens = jest.spyOn(repo, 'revokeFamilyTokens');

    const settled = await Promise.allSettled([svc.refresh(login.refreshToken), svc.refresh(login.refreshToken)]);

    const ok = settled.filter((r) => r.status === 'fulfilled') as Array<PromiseFulfilledResult<any>>;
    const errs = settled.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(errs).toHaveLength(1);
    // Mesmo contrato HTTP: 401 seco `INVALID_TOKEN` (não `REUSE_DETECTED`).
    expect((errs[0].reason as AuthError).code).toBe('INVALID_TOKEN');
    expect((errs[0].reason as AuthError).status).toBe(401);

    // Nada de revogação de família/tokens nem do outbox de sessão revogada...
    expect(revokeFamily).not.toHaveBeenCalled();
    expect(revokeTokens).not.toHaveBeenCalled();
    expect(repo.outbox.map((o) => o.type)).not.toContain('auth.session.revoked.v1');
    // ...e NENHUM evento de segurança de reuso foi emitido.
    expect(audit.calls.filter((c) => c.meta.includes('REUSE_DETECTED'))).toHaveLength(0);

    // O token do perdedor continua `ROTATED` (nunca é marcado `REUSED`).
    const loserRow = (await repo.findRefreshTokenByHash(sha256Hex(login.refreshToken)))!;
    expect(loserRow.status).toBe('ROTATED');

    // Sessão e filho do vencedor seguem vivos — o usuário NÃO é deslogado.
    const sessions = [...repo.sessions.values()].filter((s) => s.familyId === loserRow.familyId);
    expect(sessions).toHaveLength(1);
    expect(sessions.every((s) => s.status === 'ACTIVE')).toBe(true);
    expect(activeTokens(repo)).toHaveLength(1);
    const carried: any = await svc.refresh(ok[0].value.refreshToken);
    expect(carried.accessToken).toBeTruthy();
  });

  it('(a2) replay SEQUENCIAL recente (< janela) é a mesma corrida benigna: 401 seco, token segue ROTATED', async () => {
    const { repo, svc, login } = await makeServiceAndLogin('seq-grace@example.com');
    const revokeFamily = jest.spyOn(repo, 'revokeFamilySessions');
    const second: any = await svc.refresh(login.refreshToken); // rotação legítima (vencedor)

    // Mesmo token de novo, imediatamente (caminho A): dentro da janela é a
    // mesma corrida benigna — aba/dispositivo que não viu a resposta do vencedor.
    await expect(svc.refresh(login.refreshToken)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });

    expect(revokeFamily).not.toHaveBeenCalled();
    expect((await repo.findRefreshTokenByHash(sha256Hex(login.refreshToken)))!.status).toBe('ROTATED');
    // O filho do vencedor continua válido (família preservada).
    const again: any = await svc.refresh(second.refreshToken);
    expect(again.accessToken).toBeTruthy();
  });

  it('(b) replay com rotação MAIS VELHA que a janela: família revogada + REUSE_DETECTED', async () => {
    const { repo, svc, login } = await makeServiceAndLogin('old-replay@example.com');
    const audit = captureSecurityEvents();
    const second: any = await svc.refresh(login.refreshToken); // rotação legítima (vencedor)

    // Envelhece a rotação além da janela: agora é replay antigo = roubo.
    const rotatedRow = (await repo.findRefreshTokenByHash(sha256Hex(login.refreshToken)))!;
    expect(rotatedRow.status).toBe('ROTATED');
    await repo.updateRefreshToken(rotatedRow.id, { rotatedAt: new Date(Date.now() - ROTATION_GRACE_MS - 1) });

    await expect(svc.refresh(login.refreshToken)).rejects.toMatchObject({ code: 'REUSE_DETECTED' });

    // Comportamento atual preservado: família inteira morre, inclusive o filho.
    const claims = svc.verifyAccess(login.accessToken);
    const session = (await repo.findSessionById(claims.sessionId))!;
    expect(session.status).toBe('REVOKED');
    expect(session.revokedReason).toBe('REUSE_DETECTED');
    expect((await repo.findRefreshTokenByHash(sha256Hex(login.refreshToken)))!.status).toBe('REUSED');
    expect(activeTokens(repo)).toHaveLength(0);
    expect(repo.outbox.map((o) => o.type)).toContain('auth.session.revoked.v1');
    await expect(svc.refresh(second.refreshToken)).rejects.toMatchObject({ code: 'REUSE_DETECTED' });
    // O evento de segurança de reuso FOI emitido (caso não-benigno).
    expect(audit.calls.filter((c) => c.meta.includes('REUSE_DETECTED')).length).toBeGreaterThan(0);
  });

  for (const status of ['REVOKED', 'REUSED'] as const) {
    it(`(c) token com status ${status}: comportamento atual preservado (família revogada)`, async () => {
      const { repo, svc, login } = await makeServiceAndLogin(`status-${status.toLowerCase()}@example.com`);
      const revokeFamily = jest.spyOn(repo, 'revokeFamilySessions');
      const row = (await repo.findRefreshTokenByHash(sha256Hex(login.refreshToken)))!;
      // `rotatedAt` fresco DE PROPÓSITO: só `ROTATED` conta como corrida
      // benigna; `REVOKED`/`REUSED` são token explicitamente morto.
      await repo.updateRefreshToken(row.id, { status, rotatedAt: new Date() });

      await expect(svc.refresh(login.refreshToken)).rejects.toMatchObject({ code: 'REUSE_DETECTED' });

      expect(revokeFamily).toHaveBeenCalledWith(row.familyId, 'REUSE_DETECTED');
      const claims = svc.verifyAccess(login.accessToken);
      expect((await repo.findSessionById(claims.sessionId))!.status).toBe('REVOKED');
      expect(activeTokens(repo)).toHaveLength(0);
    });
  }

  it('(d) caminho B: CAS perdido + releitura com ROTATED recente → benigno (sem revogar)', async () => {
    const { repo, svc, login } = await makeServiceAndLogin('cas-loser@example.com');
    const audit = captureSecurityEvents();
    const revokeFamily = jest.spyOn(repo, 'revokeFamilySessions');
    const row = (await repo.findRefreshTokenByHash(sha256Hex(login.refreshToken)))!;

    // Simula o instante exato entre o CAS perdido e a releitura: outro request
    // venceu a corrida e gravou `ROTATED` + `rotated_at` fresco. O `rec` lido
    // pelo serviço ainda diz `ACTIVE` — a decisão tem de usar a releitura.
    jest.spyOn(repo, 'rotateRefreshToken').mockImplementationOnce(async () => {
      await repo.updateRefreshToken(row.id, { status: 'ROTATED', rotatedAt: new Date() });
      return null;
    });

    await expect(svc.refresh(login.refreshToken)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });

    expect(revokeFamily).not.toHaveBeenCalled();
    expect((await repo.findRefreshTokenByHash(sha256Hex(login.refreshToken)))!.status).toBe('ROTATED');
    const claims = svc.verifyAccess(login.accessToken);
    expect((await repo.findSessionById(claims.sessionId))!.status).toBe('ACTIVE');
    expect(repo.outbox.map((o) => o.type)).not.toContain('auth.session.revoked.v1');
    expect(audit.calls.filter((c) => c.meta.includes('REUSE_DETECTED'))).toHaveLength(0);
  });
});

// ===========================================================================
// D2-2 — lockout de login não atômico
// ===========================================================================

describe('D2-2 contador de falhas de login é atômico', () => {
  it('5 logins errados CONCORRENTES contam 5 e travam a conta', async () => {
    const { repo, svc } = makeService();
    const { identity } = await readyIdentity(svc, 'lock@example.com');
    expect(identity.failedAttempts).toBe(0);

    // Antes da correção os 5 liam failedAttempts=0 e gravavam 1 (valor
    // absoluto) — a conta NUNCA travava e MAX_FAILED_ATTEMPTS ficava inatingível.
    await Promise.allSettled(Array.from({ length: 5 }, () => svc.login({ email: 'lock@example.com', password: 'wrong-pass-00' })));

    const after = (await repo.findIdentityByEmailNorm('lock@example.com'))!;
    expect(after.failedAttempts).toBe(5);
    expect(after.status).toBe('LOCKED');
    expect(after.lockedUntil).toBeTruthy();
    await expect(svc.login({ email: 'lock@example.com', password: 'strong-pass-01' })).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });

  it('SQL: incrementa no statement (failed_attempts + 1) e deriva o lockout no mesmo UPDATE', async () => {
    let row: Record<string, unknown> = { id: 'id-1', failed_attempts: 0, status: 'ACTIVE', locked_until: null, createdAt: new Date() };
    const seen: string[] = [];
    const query = jest.fn(async (sqlText: string) => {
      seen.push(sqlText);
      if (!sqlText.startsWith('UPDATE auth.user_identities')) return { rows: [], rowCount: 0 };
      // Sem o `+ 1` (ou com leitura antes do write) o contador não acumula.
      expect(sqlText).toContain('failed_attempts = failed_attempts + 1');
      expect(sqlText).toContain('CASE WHEN failed_attempts + 1 >= $2 THEN $3 ELSE status END');
      expect(sqlText).toContain('RETURNING *');
      const max = 5 as number;
      const next = (row.failed_attempts as number) + 1;
      row = {
        ...row,
        failed_attempts: next,
        status: next >= max ? 'LOCKED' : row.status,
        locked_until: next >= max ? new Date() : row.locked_until,
      };
      return { rows: [row], rowCount: 1 };
    });
    const repo = new PgAuthRepository(undefined, { query } as never);
    const input = { id: 'id-1', max: 5, lockedStatus: 'LOCKED', lockedUntil: new Date() };

    for (let i = 0; i < 5; i++) {
      const r = await repo.incrementFailedAttempts(input);
      expect(r.failedAttempts).toBe(i + 1);
    }
    expect((await repo.incrementFailedAttempts(input)).status).toBe('LOCKED');
    expect(seen).toHaveLength(6);
  });
});

// ===========================================================================
// D2-3 — chave de encriptação do MFA
// ===========================================================================

describe('D2-3 chave do segredo MFA é dedicada e rotacionável', () => {
  const KEY_A = 'a1b2c3d4'.repeat(8);
  const KEY_B = 'f0e1d2c3'.repeat(8);

  afterEach(() => {
    delete process.env.MFA_ENC_KEY;
    delete process.env.MFA_ENC_KEY_PREVIOUS;
  });

  it('fail-fast: em produção, MFA_ENC_KEY ausente aborta o boot', () => {
    expect(() => assertMfaEncKeyConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/MFA_ENC_KEY ausente/);
    expect(() => assertMfaEncKeyConfig({ NODE_ENV: 'production', MFA_ENC_KEY: KEY_A } as NodeJS.ProcessEnv)).not.toThrow();
    // Dev/test seguem com o fallback (não quebra ambiente existente).
    expect(() => assertMfaEncKeyConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertMfaEncKeyConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('(c) ciphertext legado SEM kid (derivado do JWT secret) continua legível após adotar MFA_ENC_KEY', async () => {
    const repo = new InMemoryAuthRepository();
    const svc = new AuthService(repo, { jwtSecret: SECRET });
    const { identity } = await readyIdentity(svc, 'legacy@example.com');

    // Segredo gravado no formato ANTIGO (4 partes, sem key-id), cifrado com a
    // chave derivada do segredo JWT — é o estado real em produção hoje.
    const plain = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    await repo.updateCredential(identity.id, { mfaSecretEnc: encryptSecret(plain, deriveEncKey(MFA_LABEL, SECRET)) });
    expect(String((await repo.findCredentialByIdentityId(identity.id))!.mfaSecretEnc).split('.')).toHaveLength(4);

    process.env.MFA_ENC_KEY = KEY_A;
    const rotated = new AuthService(repo, { jwtSecret: SECRET });
    await expect(rotated.mfaVerifyEnrollment(identity.id, totpCode(plain))).resolves.toEqual({ ok: true });
    expect((await repo.findIdentityById(identity.id))!.mfaEnabled).toBe(true);
  });

  it('(b) o payload novo carrega kid e sobrevive à rotação via MFA_ENC_KEY_PREVIOUS', async () => {
    const repo = new InMemoryAuthRepository();
    const svc = new AuthService(repo, { jwtSecret: SECRET });
    const { identity } = await readyIdentity(svc, 'rotate@example.com');

    process.env.MFA_ENC_KEY = KEY_A;
    const enroll = await svc.mfaEnroll(identity.id);
    const stored = String((await repo.findCredentialByIdentityId(identity.id))!.mfaSecretEnc);
    expect(stored.split('.')).toHaveLength(5); // v1.<kid>.<iv>.<ct>.<tag>
    expect(stored.split('.')[1]).toMatch(/^[0-9a-f]{8}$/);

    // Rotaciona: KEY_B vira a corrente, KEY_A fica na lista de anteriores.
    process.env.MFA_ENC_KEY = KEY_B;
    process.env.MFA_ENC_KEY_PREVIOUS = KEY_A;
    const afterRotation = new AuthService(repo, { jwtSecret: SECRET });
    await expect(afterRotation.mfaVerifyEnrollment(identity.id, totpCode(enroll.secret))).resolves.toEqual({ ok: true });

    // Sem a chave anterior, o segredo é IRRECUPERÁVEL — e isso é erro
    // CONTROLADO (código próprio), não um 500 mudo de AES.
    process.env.MFA_ENC_KEY_PREVIOUS = undefined as never;
    delete process.env.MFA_ENC_KEY_PREVIOUS;
    const broken = new AuthService(repo, { jwtSecret: SECRET });
    await expect(broken.mfaVerifyEnrollment(identity.id, totpCode(enroll.secret))).rejects.toMatchObject({ code: 'MFA_SECRET_UNREADABLE' });
  });

  it('a chave corrente grava/decifra com o kid correto (roundtrip do keyring)', () => {
    const key = deriveEncKey(MFA_LABEL, KEY_A);
    const enc = encryptSecret('SECRETB32', key, 'deadbeef');
    // Chave ERRADA (buffer de zeros) tem de FALHAR o auth tag do AES-GCM: o
    // kid ausente do keyring cai na chave corrente fornecida, e essa está errada.
    expect(() => decryptSecret(enc, Buffer.alloc(32))).toThrow();
    // Chave correta resolvida pelo kid no keyring (rotação sem quebrar MFA).
    const ring = new Map([['deadbeef', key]]);
    expect(decryptSecret(enc, Buffer.alloc(32), { keyring: ring })).toBe('SECRETB32');
    // A chave corrente também decifra sem keyring.
    expect(decryptSecret(enc, key)).toBe('SECRETB32');
  });
});

// ===========================================================================
// D2-4 — placeholder passa a validação
// ===========================================================================

describe('D2-4 segredos placeholder não passam na validação', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', REDIS_URL: 'redis://localhost:6379' };

  it('rejeita o JWT_SECRET do .env.example (TROCAR_*, 39 chars, passava em min(16))', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'TROCAR_JWT_SECRET_GERADO_MIN_32_BYTES' })).toThrow(/placeholder/);
    expect(() => validateEnv({ ...base, JWT_SECRET: 'changeme' })).toThrow(/placeholder/);
    expect(() => validateEnv({ ...base, JWT_SECRET: 'CHANGE-ME-PLEASE-NOW-1234' })).toThrow(/placeholder/);
    expect(() => validateEnv({ ...base, JWT_SECRET: 'TROCAR_MFA_ENC_KEY_GERADA' })).toThrow(/placeholder/);
  });

  it('rejeita placeholder em MFA_ENC_KEY e valida o piso de tamanho', () => {
    expect(() => validateEnv({ ...base, MFA_ENC_KEY: 'TROCAR_MFA_ENC_KEY_GERADA_MIN_64' })).toThrow(/placeholder/);
    expect(() => validateEnv({ ...base, MFA_ENC_KEY: 'curta' })).toThrow(/32 chars/);
    // 64 chars realistas passam o piso de tamanho. Nota: 'x'.repeat(64) é
    // REJEITADO de propósito — casa com o placeholder /^xxx/i.
    expect(() => validateEnv({ ...base, MFA_ENC_KEY: 'x'.repeat(64) })).toThrow(/placeholder/);
    expect(() => validateEnv({ ...base, MFA_ENC_KEY: '9f3a7c1bd4e280f65a1c9d38e7b04f2615ad93c7e8b120d6f349ac5710be82df' })).not.toThrow();
  });

  it('AUTH_JWT_SECRET passa a existir no schema (antes: zero validação)', () => {
    expect(() => validateEnv({ ...base, AUTH_JWT_SECRET: 'curto' })).toThrow(/16 chars/);
    expect(() => validateEnv({ ...base, AUTH_JWT_SECRET: 'TROCAR_AUTH_JWT_SECRET_AQUI' })).toThrow(/placeholder/);
    // Com os DOIS definidos e IGUAIS (P0-2): aceito e preservado.
    expect(validateEnv({ ...base, JWT_SECRET: 'z'.repeat(40), AUTH_JWT_SECRET: 'z'.repeat(40) }).AUTH_JWT_SECRET).toHaveLength(40);
  });

  it('NÃO quebra o modo de teste: o default de teste continua aceito', () => {
    // setup-e2e.ts fixa exatamente este valor; está na whitelist.
    expect(validateEnv(base).JWT_SECRET).toBe('test-only-secret-min-16-chars');
    expect(() => validateEnv({ ...base, JWT_SECRET: 'test-only-secret-min-16-chars' })).not.toThrow();
  });

  it('NÃO quebra o .env de desenvolvimento real (64 hex) e exige MFA_ENC_KEY em produção', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: '19366c31d0752fa6e08a2add9e66c9a1551b3d85a4e26b759238a056a0fc657c' })).not.toThrow();
    const prod = { ...base, NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(48) };
    // As 9 DATABASE_URL_* de domínio também são obrigatórias em produção: para
    // isolar a asserção de MFA_ENC_KEY, preenche todas.
    const domains = ['AUTH', 'CUSTOMERS', 'PRODUCTS', 'ACCESS', 'LICENSING', 'BILLING', 'FINANCE', 'AUDIT', 'COMMUNICATIONS'];
    const full: Record<string, unknown> = { ...prod };
    for (const d of domains) full[`DATABASE_URL_${d}`] = 'postgres://u:p@localhost:6432/aurumbit';
    let caught = '';
    try {
      validateEnv(full);
    } catch (e) {
      caught = (e as Error).message;
    }
    expect(caught).toMatch(/MFA_ENC_KEY é obrigatória em produção/);
    expect(() => validateEnv({ ...full, MFA_ENC_KEY: 'k'.repeat(64) })).not.toThrow();
  });
});

// ===========================================================================
// P0-2 — AUTH_JWT_SECRET divergente de JWT_SECRET = 401 em TODA request
// ===========================================================================

describe('P0-2 AUTH_JWT_SECRET divergente de JWT_SECRET aborta o boot', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', REDIS_URL: 'redis://localhost:6379' };
  const JWT_A = '9f3a7c1bd4e280f65a1c9d38e7b04f2615ad93c7e8b120d6f349ac5710be82df';
  const JWT_B = '19366c31d0752fa6e08a2add9e66c9a1551b3d85a4e26b759238a056a0fc657c';

  it('(a) só JWT_SECRET (`.env` de dev e `setup-e2e.ts`) continua válido', () => {
    expect(validateEnv(base).AUTH_JWT_SECRET).toBeUndefined();
    expect(() => validateEnv({ ...base, JWT_SECRET: JWT_A })).not.toThrow();
    expect(() => validateEnv({ ...base, JWT_SECRET: 'test-only-secret-min-16-chars' })).not.toThrow();
  });

  it('(b) AUTH_JWT_SECRET === JWT_SECRET é aceito', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: JWT_A, AUTH_JWT_SECRET: JWT_A })).not.toThrow();
  });

  it('(c) os dois definidos e DIFERENTES falha com mensagem que aponta a divergência', () => {
    let caught = '';
    try {
      validateEnv({ ...base, JWT_SECRET: JWT_A, AUTH_JWT_SECRET: JWT_B });
    } catch (e) {
      caught = (e as Error).message;
    }
    expect(caught).toMatch(/AUTH_JWT_SECRET/);
    expect(caught).toMatch(/JWT_SECRET/);
    expect(caught).toMatch(/401/);
    // O segredo NÃO pode vazar na mensagem de erro (log de boot).
    expect(caught).not.toContain(JWT_A);
    expect(caught).not.toContain(JWT_B);
  });

  it('o bug real: o token emitido com AUTH_JWT_SECRET é rejeitado pelo JwtAuthGuard', async () => {
    const prevJwt = process.env.JWT_SECRET;
    const prevAuth = process.env.AUTH_JWT_SECRET;
    try {
      process.env.JWT_SECRET = JWT_A;
      process.env.AUTH_JWT_SECRET = JWT_B;
      // Mesma precedência que `auth.module.ts:30` monta no app real.
      const svc = new AuthService(new InMemoryAuthRepository(), {
        jwtSecret: process.env.AUTH_JWT_SECRET ?? process.env.JWT_SECRET ?? 'dev-only-insecure-secret',
      });
      const { login } = await loggedIn(svc, 'divergente@example.com');
      // O guard resolve SÓ `JWT_SECRET` (jwt.service.ts:28) => assinatura inválida.
      expect(() => new JwtService().verify(login.accessToken)).toThrow(/Assinatura JWT inválida/);
      // Mesma config com os segredos IGUAIS (o que o boot agora exige): um token
      // NOVO é emitido (a assinatura é feita na emissão) e o guard aceita.
      process.env.AUTH_JWT_SECRET = JWT_A;
      const aligned = new AuthService(new InMemoryAuthRepository(), {
        jwtSecret: process.env.AUTH_JWT_SECRET ?? process.env.JWT_SECRET ?? 'dev-only-insecure-secret',
      });
      const { login: alignedLogin } = await loggedIn(aligned, 'alinhado@example.com');
      expect(() => new JwtService().verify(alignedLogin.accessToken)).not.toThrow();
    } finally {
      if (prevJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevJwt;
      if (prevAuth === undefined) delete process.env.AUTH_JWT_SECRET;
      else process.env.AUTH_JWT_SECRET = prevAuth;
    }
  });
});

// ---------------------------------------------------------------------------

async function makeServiceAndLogin(email: string) {
  const { repo, svc } = makeService();
  const { login } = await loggedIn(svc, email);
  return { repo, svc, login };
}
