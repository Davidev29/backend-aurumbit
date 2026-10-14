import { DevicesService, DeviceLimitError, DeviceConflictError } from './devices.service';

// Fase 3 — devices: limite, rotate 15min, clone. Pool PG mockado (sem banco).
// Convenção do mock: `query` responde por prefixo do SQL (SELECT/INSERT/UPDATE/DELETE/BEGIN...).

const H = (c: string) => c.repeat(64);
const OLD = H('a');
const NEW1 = H('b');
const NEW2 = H('c');

function licRow(over: Record<string, unknown> = {}) {
  return {
    id: 'lic-1',
    ownerId: 'cust-1',
    productId: 'prod-1',
    planId: null,
    status: 'active',
    startsAt: new Date('2026-09-10T00:00:00Z'),
    expiresAt: new Date('2026-11-10T00:00:00Z'),
    graceUntil: new Date('2026-11-13T00:00:00Z'),
    tokenVersion: 1,
    maxDevices: 1,
    features: ['F1'],
    ...over,
  };
}

function devRow(hash: string, over: Record<string, unknown> = {}) {
  return {
    id: `dev-${hash.slice(0, 4)}`,
    licenseId: 'lic-1',
    device_hash: hash,
    device_label_enc: null,
    firstSeenAt: new Date('2026-10-01T00:00:00Z'),
    lastSeenAt: new Date('2026-10-09T12:00:00Z'),
    ip_hint: '10.0.0.0/24',
    ip_hash: 'h',
    status: 'active',
    cloned_suspect: false,
    cloned_evidence: null,
    rotated_to: null,
    rotate_expires_at: null,
    last_ctr: 3,
    last_country: 'BR',
    ...over,
  };
}

type Handler = (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[]; rowCount?: number };

function mockPool(handler: Handler) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const q = async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    const out = handler(sql, params);
    return { rows: out.rows as never[], rowCount: out.rowCount ?? out.rows.length };
  };
  const client = { query: q, release: jest.fn() };
  const pool = { query: q, connect: jest.fn(async () => client) };
  return { pool, queries, client };
}

const NOW = new Date('2026-10-10T12:00:00.000Z');

// O tipo do outbox viaja em params ($5), não no SQL — ver `insertOutbox`.
function emittedOutbox(
  queries: Array<{ sql: string; params?: unknown[] }>,
  type: string,
): boolean {
  return queries.some((x) => (JSON.stringify(x.params ?? []) as string).includes(type));
}

describe('DevicesService — limite (COUNT FOR UPDATE → 409 DEVICE_LIMIT)', () => {
  it('nega quando o limite foi atingido e retorna a lista', async () => {
    const existing = devRow(OLD);
    const { pool, queries } = mockPool((sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.startsWith('SELECT id, "ownerId"')) return { rows: [licRow()] }; // lock licença
      if (sql.includes('AND device_hash') && (params as string[])?.[1] === NEW1) return { rows: [] };
      if (sql.includes('COUNT(*)')) return { rows: [{ n: 1 }] }; // 1 ativo, max 1
      if (sql.includes("status = 'active'") && sql.includes('ORDER BY')) return { rows: [existing] };
      throw new Error(`SQL inesperado: ${sql}`);
    });
    const svc = new DevicesService(pool as never);
    const err = await svc.linkDevice('lic-1', { device_hash: NEW1 }, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(DeviceLimitError);
    expect((err as DeviceLimitError).code).toBe('DEVICE_LIMIT');
    expect((err as DeviceLimitError).devices).toHaveLength(1);
    expect((err as DeviceLimitError).devices[0].device_hash).toBe(OLD);
    expect(queries.some((x) => x.sql.includes('FOR UPDATE'))).toBe(true);
  });

  it('vincula quando há vaga e emite DeviceLinked', async () => {
    const { pool, queries } = mockPool((sql, params) => {
      if (sql.startsWith('SELECT id, "ownerId"')) return { rows: [licRow({ maxDevices: 3 })] };
      if (sql.includes('AND device_hash')) return { rows: [] };
      if (sql.includes('COUNT(*)')) return { rows: [{ n: 1 }] };
      if (sql.startsWith('INSERT INTO license_devices')) {
        return { rows: [devRow((params as string[])[2] as string)] };
      }
      if (sql.startsWith('INSERT INTO outbox_events')) return { rows: [] };
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      throw new Error(`SQL inesperado: ${sql}`);
    });
    const svc = new DevicesService(pool as never);
    const out = await svc.linkDevice('lic-1', { device_hash: NEW2 }, NOW);
    expect(out.created).toBe(true);
    expect(out.device.device_hash).toBe(NEW2);
    expect(emittedOutbox(queries, 'DeviceLinked.v1')).toBe(true);
  });

  it('re-link do mesmo hash é idempotente', async () => {
    const { pool } = mockPool((sql) => {
      if (sql.startsWith('SELECT id, "ownerId"')) return { rows: [licRow()] };
      if (sql.includes('AND device_hash')) return { rows: [devRow(OLD)] };
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      throw new Error(`SQL inesperado: ${sql}`);
    });
    const svc = new DevicesService(pool as never);
    const out = await svc.linkDevice('lic-1', { device_hash: OLD }, NOW);
    expect(out.created).toBe(false);
  });
});

describe('DevicesService — rotate (janela 15min, duplo-aceite)', () => {
  function rotatePool() {
    return mockPool((sql, params) => {
      if (sql.startsWith('SELECT id, status')) return { rows: [{ id: 'lic-1', status: 'active' }] };
      if (sql.includes('AND device_hash') && (params as string[])?.[1] === OLD) return { rows: [devRow(OLD)] };
      if (sql.includes('AND device_hash') && (params as string[])?.[1] === NEW1) {
        return sql.includes('SELECT id FROM') ? { rows: [] } : { rows: [] };
      }
      if (sql.startsWith('INSERT INTO license_devices')) return { rows: [devRow(NEW1)] };
      if (sql.startsWith('UPDATE license_devices SET status')) return { rows: [] };
      if (sql.startsWith('INSERT INTO outbox_events')) return { rows: [] };
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      throw new Error(`SQL inesperado: ${sql}`);
    });
  }

  it('rotaciona e abre janela de 15min com DeviceRotated', async () => {
    const { pool, queries } = rotatePool();
    const svc = new DevicesService(pool as never);
    const out = await svc.rotateDevice('lic-1', { oldHash: OLD, newHash: NEW1 }, NOW);
    expect(out.oldDevice.status).toBe('rotated');
    expect(out.newDevice.device_hash).toBe(NEW1);
    expect(out.dualAcceptUntil.getTime() - NOW.getTime()).toBe(15 * 60_000);
    expect(emittedOutbox(queries, 'DeviceRotated.v1')).toBe(true);
  });

  it('hash antigo dentro da janela → DUAL_ACCEPT_ROTATE; após → ROTATED_EXPIRED', async () => {
    async function validateAt(now: Date, rotateExpires: Date) {
      const { pool } = mockPool((sql, params) => {
        if (sql.startsWith('SELECT id, "ownerId"')) return { rows: [licRow()] };
        if (sql.includes('AND device_hash')) {
          return {
            rows: [devRow(OLD, { status: 'rotated', rotated_to: NEW1, rotate_expires_at: rotateExpires })],
          };
        }
        if (sql.startsWith('UPDATE license_devices SET "lastSeenAt"')) return { rows: [] };
        if (sql.startsWith('INSERT INTO outbox_events')) return { rows: [] };
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        throw new Error(`SQL inesperado: ${sql}`);
      });
      const svc = new DevicesService(pool as never);
      return svc.validateOnline('lic-1', { deviceHash: OLD, country: 'BR', ctr: 4 }, now);
    }
    const within = await validateAt(new Date('2026-10-10T12:10:00Z'), new Date('2026-10-10T12:15:00Z'));
    expect(within).toMatchObject({ allow: true, reason: 'DUAL_ACCEPT_ROTATE' });
    const after = await validateAt(new Date('2026-10-10T12:16:00Z'), new Date('2026-10-10T12:15:00Z'));
    expect(after).toEqual({ allow: false, degraded: false, reason: 'ROTATED_EXPIRED' });
  });

  it('novo hash já vinculado → DEVICE_CONFLICT', async () => {
    const { pool } = mockPool((sql, params) => {
      if (sql.startsWith('SELECT id, status')) return { rows: [{ id: 'lic-1', status: 'active' }] };
      if (sql.includes('AND device_hash') && (params as string[])?.[1] === OLD) return { rows: [devRow(OLD)] };
      if (sql.includes('SELECT id FROM license_devices')) return { rows: [{ id: 'x' }] };
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      throw new Error(`SQL inesperado: ${sql}`);
    });
    const svc = new DevicesService(pool as never);
    const err = await svc.rotateDevice('lic-1', { oldHash: OLD, newHash: NEW1 }, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(DeviceConflictError);
    expect((err as DeviceConflictError).code).toBe('DEVICE_CONFLICT');
  });
});

describe('DevicesService — clone (marca + outbox + DENY CLONE_SUSPECT)', () => {
  async function validateWith(device: Record<string, unknown>, sight: { country?: string; tokenIatS?: number; ctr?: number }) {
    const { pool, queries } = mockPool((sql) => {
      if (sql.startsWith('SELECT id, "ownerId"')) return { rows: [licRow()] };
      if (sql.includes('AND device_hash')) return { rows: [device] };
      if (sql.startsWith('UPDATE license_devices SET cloned_suspect')) return { rows: [] };
      if (sql.startsWith('INSERT INTO outbox_events')) return { rows: [] };
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      throw new Error(`SQL inesperado: ${sql}`);
    });
    const svc = new DevicesService(pool as never);
    const decision = await svc.validateOnline('lic-1', { deviceHash: OLD, ...sight }, NOW);
    return { decision, queries };
  }

  it('geo impossível (BR→JP em minutos) → CLONE_SUSPECT + DeviceCloneSuspected', async () => {
    // lastSeen 30min antes: troca BR→JP em 30min < 2h = deslocamento impossível.
    const recent = devRow(OLD, { lastSeenAt: new Date('2026-10-10T11:30:00.000Z') });
    const { decision, queries } = await validateWith(recent, { country: 'JP', ctr: 4 });
    expect(decision).toEqual({ allow: false, degraded: false, reason: 'CLONE_SUSPECT' });
    expect(emittedOutbox(queries, 'DeviceCloneSuspected.v1')).toBe(true);
    expect(queries.some((x) => x.sql.includes('cloned_suspect = true'))).toBe(true);
  });

  it('iat futuro → CLONE_SUSPECT', async () => {
    const { decision } = await validateWith(devRow(OLD), {
      country: 'BR',
      tokenIatS: Math.floor(NOW.getTime() / 1000) + 3600,
      ctr: 4,
    });
    expect(decision).toEqual({ allow: false, degraded: false, reason: 'CLONE_SUSPECT' });
  });

  it('contador divergente → CLONE_SUSPECT', async () => {
    const { decision } = await validateWith(devRow(OLD, { last_ctr: 10 }), { country: 'BR', ctr: 2 });
    expect(decision).toEqual({ allow: false, degraded: false, reason: 'CLONE_SUSPECT' });
  });

  it('device já marcado → DENY direto sem reemitir outbox', async () => {
    const { decision, queries } = await validateWith(devRow(OLD, { cloned_suspect: true }), { country: 'BR', ctr: 4 });
    expect(decision).toEqual({ allow: false, degraded: false, reason: 'CLONE_SUSPECT' });
    expect(emittedOutbox(queries, 'DeviceCloneSuspected.v1')).toBe(false);
  });

  it('device bloqueado → DEVICE_BLOCKED', async () => {
    const { decision } = await validateWith(devRow(OLD, { status: 'blocked' }), { country: 'BR' });
    expect(decision).toEqual({ allow: false, degraded: false, reason: 'DEVICE_BLOCKED' });
  });
});
