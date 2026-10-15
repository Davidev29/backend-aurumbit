import {
  SECURITY_EVENT_TYPES,
  __setSecurityEventPoolForTests,
  emitSecurityEvent,
  sanitizeSecurityMetadata,
} from './security-events';

// E7 (Fase 9) — helper de security_events: só INSERT, metadata sem PII,
// vocabulário fechado em 6 tipos, nunca quebra o chamador.

function mockPool(handler?: (sql: string, params?: unknown[]) => void) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      handler?.(sql, params);
      return { rows: [], rowCount: 1 };
    },
  };
  return { pool, queries };
}

describe('security-events — vocabulário fechado (6 tipos)', () => {
  it('expõe exatamente os 6 tipos do CHECK do DDL', () => {
    expect([...SECURITY_EVENT_TYPES].sort()).toEqual(
      [
        'CLONE_SUSPECT',
        'DEVICE_BLOCKED',
        'KEY_REVEALED',
        'LOGIN_FAILED',
        'MFA_FAILED',
        'TOKEN_ROTATED',
      ].sort(),
    );
  });

  it('tipo fora do vocabulário → throw (fail-fast de programador)', async () => {
    const { pool, queries } = mockPool();
    await expect(
      emitSecurityEvent(pool, { type: 'HACKED' as never }),
    ).rejects.toThrow(/inválido/);
    expect(queries).toHaveLength(0);
  });
});

describe('security-events — metadata sem PII (allowlist)', () => {
  it('descarta e-mail/ip/token/chave/appInstanceId', () => {
    expect(
      sanitizeSecurityMetadata({
        reason: 'INVALID_CREDENTIALS',
        reasons: ['ctr-rollback'],
        keyMasked: 'AURUM-••••-AB12',
        device_hash: 'abc123',
        familyId: 'fam-1',
        correlationId: 'corr-1',
        email: 'user@example.com',
        ip: '10.0.0.1',
        token: 'raw-token',
        password: 'segredo',
        licenseKey: 'AURUM-AAAA-BBBB-CC12',
        key_hash: 'deadbeef',
        appInstanceId: 'inst-1',
        city: 'São Paulo',
      }),
    ).toEqual({
      reason: 'INVALID_CREDENTIALS',
      reasons: ['ctr-rollback'],
      keyMasked: 'AURUM-••••-AB12',
      device_hash: 'abc123',
      familyId: 'fam-1',
      correlationId: 'corr-1',
    });
  });

  it('KEY_REVEALED preserva keyMasked e descarta chave plaintext (PII/segredo)', async () => {
    const { pool, queries } = mockPool();
    await emitSecurityEvent(pool, {
      type: 'KEY_REVEALED',
      actorId: 'u-1',
      entity: 'license',
      entityId: 'lic-1',
      metadata: { keyMasked: 'AURUM-••••-AB12', licenseKey: 'PLAIN' },
    });
    expect(queries).toHaveLength(1);
    const params = queries[0].params as unknown[];
    expect(params[0]).toBe('KEY_REVEALED');
    expect(JSON.parse(params[4] as string)).toEqual({ keyMasked: 'AURUM-••••-AB12' });
  });
});

describe('security-events — só INSERT, nunca quebra o chamador', () => {
  it('emite INSERT schema-qualificado em audit.security_events', async () => {
    const { pool, queries } = mockPool();
    await emitSecurityEvent(pool, {
      type: 'LOGIN_FAILED',
      actorId: 'u-1',
      entity: 'user_identity',
      entityId: 'u-1',
      metadata: { reason: 'INVALID_CREDENTIALS' },
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('INSERT INTO audit.security_events');
    expect(queries[0].sql).not.toMatch(/\bUPDATE\b|\bDELETE\b/i);
    expect(queries[0].params).toEqual([
      'LOGIN_FAILED',
      'u-1',
      'user_identity',
      'u-1',
      JSON.stringify({ reason: 'INVALID_CREDENTIALS' }),
    ]);
  });

  it('pool ausente + sem DATABASE_URL_AUDIT → no-op (resolve, sem throw)', async () => {
    const prev = process.env.DATABASE_URL_AUDIT;
    delete process.env.DATABASE_URL_AUDIT;
    __setSecurityEventPoolForTests(undefined);
    try {
      await expect(
        emitSecurityEvent(undefined, { type: 'MFA_FAILED', metadata: { reason: 'x' } }),
      ).resolves.toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL_AUDIT = prev;
      __setSecurityEventPoolForTests(undefined);
    }
  });

  it('falha do INSERT → resolve (trilha nunca quebra login/refresh/reveal)', async () => {
    const pool = {
      query: async () => {
        throw new Error('connection refused');
      },
    };
    await expect(
      emitSecurityEvent(pool, { type: 'TOKEN_ROTATED', metadata: { reason: 'ROTATED' } }),
    ).resolves.toBeUndefined();
  });
});
