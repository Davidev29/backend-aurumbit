import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { emitSecurityEvent, getSecurityEventPool } from '../audit/security-events';
import { detectCloneSuspect } from './clone-policy';
import { computeDeviceHash, decryptLabel, encryptLabel, hashIp, isValidDeviceHash, maskIp24 } from './device-hash';
import { LICENSING_POOL } from './licensing-pool.provider';

// Serviço de devices da licença (Fase 3, PROJECT.md §§1/4, REQUIREMENTS.md §2).
// Enforcement do limite no backend com COUNT ... FOR UPDATE dentro de transação.
// Retenção (PROJECT.md §4): vida da licença + 12 meses, depois anonimiza; unlink
// remove o vínculo (DELETE) mas preserva o hash na trilha (outbox DeviceUnlinked).

export const ROTATE_DUAL_ACCEPT_MS = 15 * 60_000; // janela de duplo-aceite: 15min
const DEFAULT_MAX_DEVICES = 3;

export type LicenseRow = {
  id: string;
  ownerId: string;
  productId: string;
  planId: string | null;
  status: string;
  startsAt: Date | null;
  expiresAt: Date | null;
  graceUntil: Date | null;
  tokenVersion: number;
  maxDevices: number;
  features: unknown;
};

export type DeviceRow = {
  id: string;
  licenseId: string;
  device_hash: string;
  device_label_enc: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  ip_hint: string | null;
  ip_hash: string | null;
  status: string;
  cloned_suspect: boolean;
  cloned_evidence: Record<string, unknown> | null;
  rotated_to: string | null;
  rotate_expires_at: Date | null;
  last_ctr: number | null;
  last_country: string | null;
};

export type DeviceView = {
  device_hash: string;
  label: string | null;
  status: string;
  first_seen: Date;
  last_seen: Date;
  ip_hint: string | null;
  cloned_suspect: boolean;
};

export type OnlineDecision =
  | { allow: true; degraded: boolean; reason: 'ACTIVE' | 'LIFETIME' | 'GRACE' | 'DUAL_ACCEPT_ROTATE' }
  | {
      allow: false;
      degraded: false;
      reason:
        | 'REVOKED'
        | 'SUSPENDED'
        | 'EXPIRED'
        | 'LICENSE_NOT_FOUND'
        | 'LICENSE_INACTIVE'
        | 'UNKNOWN_DEVICE'
        | 'DEVICE_BLOCKED'
        | 'CLONE_SUSPECT'
        | 'ROTATED_EXPIRED';
    };

export class LicenseNotFoundError extends Error {
  readonly code = 'LICENSE_NOT_FOUND';
  constructor(licenseId: string) {
    super(`license ${licenseId} não encontrada`);
  }
}

export class DeviceLimitError extends Error {
  readonly code = 'DEVICE_LIMIT';
  readonly devices: DeviceView[];
  constructor(devices: DeviceView[], max: number) {
    super(`limite de ${max} devices atingido`);
    this.devices = devices;
  }
}

export class DeviceConflictError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type Q = { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> };

function mapLicense(r: Record<string, unknown>): LicenseRow {
  return {
    id: String(r.id),
    ownerId: String(r.ownerId),
    productId: String(r.productId),
    planId: (r.planId as string | null) ?? null,
    status: String(r.status),
    startsAt: (r.startsAt as Date | null) ?? null,
    expiresAt: (r.expiresAt as Date | null) ?? null,
    graceUntil: (r.graceUntil as Date | null) ?? null,
    tokenVersion: Number(r.tokenVersion ?? 1),
    maxDevices: Number(r.maxDevices ?? DEFAULT_MAX_DEVICES),
    features: r.features ?? null,
  };
}

function mapDevice(r: Record<string, unknown>): DeviceRow {
  return {
    id: String(r.id),
    licenseId: String(r.licenseId),
    device_hash: String(r.device_hash),
    device_label_enc: (r.device_label_enc as string | null) ?? null,
    firstSeenAt: new Date(r.firstSeenAt as string),
    lastSeenAt: new Date(r.lastSeenAt as string),
    ip_hint: (r.ip_hint as string | null) ?? null,
    ip_hash: (r.ip_hash as string | null) ?? null,
    status: String(r.status ?? 'active'),
    cloned_suspect: Boolean(r.cloned_suspect ?? false),
    cloned_evidence: (r.cloned_evidence as Record<string, unknown> | null) ?? null,
    rotated_to: (r.rotated_to as string | null) ?? null,
    rotate_expires_at: r.rotate_expires_at ? new Date(r.rotate_expires_at as string) : null,
    last_ctr: (r.last_ctr as number | null) ?? null,
    last_country: (r.last_country as string | null) ?? null,
  };
}

export function toDeviceView(d: DeviceRow): DeviceView {
  let label: string | null = null;
  try {
    label = decryptLabel(d.device_label_enc);
  } catch {
    label = null;
  }
  return {
    device_hash: d.device_hash,
    label,
    status: d.status,
    first_seen: d.firstSeenAt,
    last_seen: d.lastSeenAt,
    ip_hint: d.ip_hint,
    cloned_suspect: d.cloned_suspect,
  };
}

const DEVICE_COLS =
  `id, "licenseId", device_hash, device_label_enc, "firstSeenAt", "lastSeenAt", ` +
  `ip_hint, ip_hash, status, cloned_suspect, cloned_evidence, rotated_to, ` +
  `rotate_expires_at, last_ctr, last_country`;

function outboxId(): string {
  return randomUUID();
}

async function insertOutbox(
  q: Q,
  event: { aggregate: string; aggregateId: string; type: string; payload: Record<string, unknown> },
): Promise<void> {
  await q.query(
    `INSERT INTO outbox_events (id, "eventId", aggregate, "aggregateId", type, payload, "occurredAt", published)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now(), false)`,
    [randomUUID(), outboxId(), event.aggregate, event.aggregateId, event.type, JSON.stringify(event.payload)],
  );
}

// Segredo canônico: LICENSING_DEVICE_SECRET (mesmo de `device-hash.util.ts`);
// DEVICE_HMAC_SECRET/JWT_SECRET são fallbacks. Ausência em produção = fail-fast.
function deviceSecret(): string {
  const s =
    process.env.LICENSING_DEVICE_SECRET ?? process.env.DEVICE_HMAC_SECRET ?? process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('LICENSING_DEVICE_SECRET ausente em produção (fail-fast).');
  }
  return 'test-only-device-secret';
}

function ipSalt(): string {
  const s =
    process.env.IP_HASH_SALT ?? process.env.LICENSING_DEVICE_SECRET ?? process.env.DEVICE_HMAC_SECRET ?? process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('IP_HASH_SALT ausente em produção (fail-fast).');
  }
  return 'test-only-ip-salt';
}

@Injectable()
export class DevicesService {
  constructor(@Inject(LICENSING_POOL) private readonly pool: Pool) {}

  async getLicense(licenseId: string): Promise<LicenseRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, "ownerId", "productId", "planId", status, "startsAt", "expiresAt",
              "graceUntil", "tokenVersion", "maxDevices", features
       FROM licenses WHERE id = $1`,
      [licenseId],
    );
    return rows.length === 0 ? null : mapLicense(rows[0] as Record<string, unknown>);
  }

  async listDevices(licenseId: string): Promise<DeviceView[]> {
    const lic = await this.getLicense(licenseId);
    if (!lic) throw new LicenseNotFoundError(licenseId);
    const { rows } = await this.pool.query(
      `SELECT ${DEVICE_COLS} FROM license_devices WHERE "licenseId" = $1 ORDER BY "firstSeenAt" ASC`,
      [licenseId],
    );
    return rows.map((r) => toDeviceView(mapDevice(r as Record<string, unknown>)));
  }

  /** Resolve o hash: deriva do app_instance_id (preferido) ou valida o hash enviado. */
  resolveDeviceHash(licenseId: string, opts: { device_hash?: string; app_instance_id?: string }): string {
    if (opts.app_instance_id) return computeDeviceHash(deviceSecret(), licenseId, opts.app_instance_id);
    if (opts.device_hash && isValidDeviceHash(opts.device_hash)) return opts.device_hash;
    throw new DeviceConflictError('INVALID_DEVICE', 'informe app_instance_id ou device_hash hex 64');
  }

  private async withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* rollback best-effort */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async linkDevice(
    licenseId: string,
    opts: { device_hash?: string; app_instance_id?: string; label?: string; ip?: string },
    now = new Date(),
  ): Promise<{ device: DeviceView; created: boolean }> {
    const hash = this.resolveDeviceHash(licenseId, opts);
    return this.withTx(async (tx) => {
      const licRes = await tx.query(
        `SELECT id, "ownerId", "productId", "planId", status, "startsAt", "expiresAt",
                "graceUntil", "tokenVersion", "maxDevices", features
         FROM licenses WHERE id = $1 FOR UPDATE`,
        [licenseId],
      );
      if (licRes.rows.length === 0) throw new LicenseNotFoundError(licenseId);
      const lic = mapLicense(licRes.rows[0] as Record<string, unknown>);
      if (lic.status !== 'active') {
        throw new DeviceConflictError('LICENSE_INACTIVE', `license com status ${lic.status}`);
      }

      const existing = await tx.query(
        `SELECT ${DEVICE_COLS} FROM license_devices WHERE "licenseId" = $1 AND device_hash = $2 FOR UPDATE`,
        [licenseId, hash],
      );
      if (existing.rows.length > 0) {
        const dev = mapDevice(existing.rows[0] as Record<string, unknown>);
        if (dev.status === 'active') return { device: toDeviceView(dev), created: false };
        if (dev.status === 'blocked') {
          throw new DeviceConflictError('DEVICE_BLOCKED', 'device bloqueado — contate o suporte');
        }
        // rotated/unlinked: segue para re-vincular como novo ciclo abaixo.
      }

      // Enforcement do limite: COUNT ... FOR UPDATE (serializa vinculações concorrentes).
      const counted = await tx.query(
        `SELECT COUNT(*)::int AS n FROM license_devices WHERE "licenseId" = $1 AND status = 'active' FOR UPDATE`,
        [licenseId],
      );
      const activeCount = Number((counted.rows[0] as Record<string, unknown>).n ?? 0);
      const max = lic.maxDevices || DEFAULT_MAX_DEVICES;
      if (activeCount >= max && existing.rows.length === 0) {
        const list = await tx.query(
          `SELECT ${DEVICE_COLS} FROM license_devices WHERE "licenseId" = $1 AND status = 'active' ORDER BY "firstSeenAt" ASC`,
          [licenseId],
        );
        throw new DeviceLimitError(
          list.rows.map((r) => toDeviceView(mapDevice(r as Record<string, unknown>))),
          max,
        );
      }

      const ipHint = maskIp24(opts.ip ?? null);
      let ipHash: string | null = null;
      try {
        ipHash = opts.ip ? hashIp(opts.ip, ipSalt()) : null;
      } catch {
        ipHash = null;
      }
      const ins = await tx.query(
        `INSERT INTO license_devices
           (id, "licenseId", device_hash, device_label_enc, "firstSeenAt", "lastSeenAt",
            ip_hint, ip_hash, status, cloned_suspect, last_country)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'active', false, null)
         ON CONFLICT ("licenseId", device_hash) DO UPDATE SET
           status = 'active', "lastSeenAt" = EXCLUDED."lastSeenAt",
           device_label_enc = COALESCE(EXCLUDED.device_label_enc, license_devices.device_label_enc),
           ip_hint = COALESCE(EXCLUDED.ip_hint, license_devices.ip_hint)
         RETURNING ${DEVICE_COLS}`,
        [randomUUID(), licenseId, hash, encryptLabel(opts.label), now.toISOString(), ipHint, ipHash],
      );
      const dev = mapDevice(ins.rows[0] as Record<string, unknown>);
      await insertOutbox(tx as unknown as Q, {
        aggregate: 'LicenseDevice',
        aggregateId: licenseId,
        type: 'DeviceLinked.v1',
        payload: { licenseId, device_hash: hash, ip_hint: ipHint, at: now.toISOString() },
      });
      return { device: toDeviceView(dev), created: true };
    });
  }

  /** Unlink: remove o vínculo (DELETE); o hash permanece na trilha via outbox. */
  async unlinkDevice(licenseId: string, deviceHash: string, now = new Date()): Promise<{ removed: boolean }> {
    return this.withTx(async (tx) => {
      const licRes = await tx.query(`SELECT id FROM licenses WHERE id = $1 FOR UPDATE`, [licenseId]);
      if (licRes.rows.length === 0) throw new LicenseNotFoundError(licenseId);
      const del = await tx.query(
        `DELETE FROM license_devices WHERE "licenseId" = $1 AND device_hash = $2`,
        [licenseId, deviceHash],
      );
      const removed = Number(del.rowCount ?? 0) > 0;
      await insertOutbox(tx as unknown as Q, {
        aggregate: 'LicenseDevice',
        aggregateId: licenseId,
        type: 'DeviceUnlinked.v1',
        payload: { licenseId, device_hash: deviceHash, removed, at: now.toISOString() },
      });
      return { removed };
    });
  }

  /**
   * Rotate: marca o hash antigo como `rotated` (apontando p/ o novo) com janela
   * de 15min de duplo-aceite; cria o novo como `active`.
   */
  async rotateDevice(
    licenseId: string,
    opts: { oldHash: string; newHash: string; label?: string; ip?: string },
    now = new Date(),
  ): Promise<{ oldDevice: DeviceView; newDevice: DeviceView; dualAcceptUntil: Date }> {
    if (opts.oldHash === opts.newHash) {
      throw new DeviceConflictError('INVALID_ROTATE', 'hashes antigo e novo são iguais');
    }
    if (!isValidDeviceHash(opts.newHash)) {
      throw new DeviceConflictError('INVALID_DEVICE', 'new_device_hash deve ser hex de 64 chars');
    }
    return this.withTx(async (tx) => {
      const licRes = await tx.query(`SELECT id, status FROM licenses WHERE id = $1 FOR UPDATE`, [licenseId]);
      if (licRes.rows.length === 0) throw new LicenseNotFoundError(licenseId);
      const oldRes = await tx.query(
        `SELECT ${DEVICE_COLS} FROM license_devices WHERE "licenseId" = $1 AND device_hash = $2 FOR UPDATE`,
        [licenseId, opts.oldHash],
      );
      if (oldRes.rows.length === 0) {
        throw new DeviceConflictError('UNKNOWN_DEVICE', 'hash antigo não vinculado a esta licença');
      }
      const old = mapDevice(oldRes.rows[0] as Record<string, unknown>);
      if (old.status === 'blocked') throw new DeviceConflictError('DEVICE_BLOCKED', 'device bloqueado');
      if (old.status === 'rotated') {
        throw new DeviceConflictError('ALREADY_ROTATED', 'hash antigo já rotacionado');
      }
      const dup = await tx.query(
        `SELECT id FROM license_devices WHERE "licenseId" = $1 AND device_hash = $2`,
        [licenseId, opts.newHash],
      );
      if (dup.rows.length > 0) {
        throw new DeviceConflictError('DEVICE_CONFLICT', 'novo hash já vinculado a esta licença');
      }
      const dualAcceptUntil = new Date(now.getTime() + ROTATE_DUAL_ACCEPT_MS);
      const ipHint = maskIp24(opts.ip ?? null);
      const ins = await tx.query(
        `INSERT INTO license_devices
           (id, "licenseId", device_hash, device_label_enc, "firstSeenAt", "lastSeenAt", ip_hint, status, cloned_suspect)
         VALUES ($1, $2, $3, $4, $5, $5, $6, 'active', false)
         RETURNING ${DEVICE_COLS}`,
        [randomUUID(), licenseId, opts.newHash, encryptLabel(opts.label), now.toISOString(), ipHint],
      );
      await tx.query(
        `UPDATE license_devices SET status = 'rotated', rotated_to = $3, rotate_expires_at = $4
         WHERE "licenseId" = $1 AND device_hash = $2`,
        [licenseId, opts.oldHash, opts.newHash, dualAcceptUntil.toISOString()],
      );
      await insertOutbox(tx as unknown as Q, {
        aggregate: 'LicenseDevice',
        aggregateId: licenseId,
        type: 'DeviceRotated.v1',
        payload: {
          licenseId,
          old_device_hash: opts.oldHash,
          new_device_hash: opts.newHash,
          dual_accept_until: dualAcceptUntil.toISOString(),
          at: now.toISOString(),
        },
      });
      const oldView: DeviceView = { ...toDeviceView(old), status: 'rotated' };
      return {
        oldDevice: oldView,
        newDevice: toDeviceView(mapDevice(ins.rows[0] as Record<string, unknown>)),
        dualAcceptUntil,
      };
    });
  }

  async blockDevice(licenseId: string, deviceHash: string, reason: string, now = new Date()): Promise<DeviceView> {
    const view = await this.withTx(async (tx) => {
      const licRes = await tx.query(`SELECT id FROM licenses WHERE id = $1 FOR UPDATE`, [licenseId]);
      if (licRes.rows.length === 0) throw new LicenseNotFoundError(licenseId);
      const upd = await tx.query(
        `UPDATE license_devices SET status = 'blocked', "lastSeenAt" = $3
         WHERE "licenseId" = $1 AND device_hash = $2
         RETURNING ${DEVICE_COLS}`,
        [licenseId, deviceHash, now.toISOString()],
      );
      if (upd.rows.length === 0) throw new DeviceConflictError('UNKNOWN_DEVICE', 'device não vinculado');
      await insertOutbox(tx as unknown as Q, {
        aggregate: 'LicenseDevice',
        aggregateId: licenseId,
        type: 'DeviceBlocked.v1',
        payload: { licenseId, device_hash: deviceHash, reason, at: now.toISOString() },
      });
      return toDeviceView(mapDevice(upd.rows[0] as Record<string, unknown>));
    });
    // E7 (Fase 9): bloqueio efetivado — trilha best-effort (fora da tx; decisão inalterada).
    void emitSecurityEvent(getSecurityEventPool(), {
      type: 'DEVICE_BLOCKED',
      entity: 'license',
      entityId: licenseId,
      metadata: { device_hash: deviceHash, reason },
    });
    return view;
  }

  /**
   * Validação online (server-side): vigência (PROJECT.md §1) + vínculo do device
   * + detecção de clone. Marca `cloned_suspect` + outbox `DeviceCloneSuspected.v1`
   * e nega com CLONE_SUSPECT quando algum sinal dispara.
   */
  async validateOnline(
    licenseId: string,
    sighting: { deviceHash: string; ip?: string; country?: string; tokenIatS?: number; ctr?: number },
    now = new Date(),
  ): Promise<OnlineDecision & { device?: DeviceView }> {
    const lic = await this.getLicense(licenseId);
    if (!lic) return { allow: false, degraded: false, reason: 'LICENSE_NOT_FOUND' };
    if (lic.status === 'revoked') return { allow: false, degraded: false, reason: 'REVOKED' };
    if (lic.status === 'suspended') return { allow: false, degraded: false, reason: 'SUSPENDED' };
    if (lic.status !== 'active') return { allow: false, degraded: false, reason: 'LICENSE_INACTIVE' };

    const nowMs = now.getTime();
    const expMs = lic.expiresAt ? lic.expiresAt.getTime() : null;
    const graceMs = lic.graceUntil ? lic.graceUntil.getTime() : null;
    let degraded = false;
    if (expMs !== null) {
      if (nowMs > expMs) {
        if (graceMs === null || nowMs > graceMs) {
          return { allow: false, degraded: false, reason: 'EXPIRED' };
        }
        degraded = true;
      }
    }

    return this.withTx(async (tx) => {
      const devRes = await tx.query(
        `SELECT ${DEVICE_COLS} FROM license_devices WHERE "licenseId" = $1 AND device_hash = $2 FOR UPDATE`,
        [licenseId, sighting.deviceHash],
      );
      if (devRes.rows.length === 0) {
        return { allow: false, degraded: false, reason: 'UNKNOWN_DEVICE' };
      }
      const dev = mapDevice(devRes.rows[0] as Record<string, unknown>);
      if (dev.status === 'blocked') return { allow: false, degraded: false, reason: 'DEVICE_BLOCKED' };
      if (dev.cloned_suspect) return { allow: false, degraded: false, reason: 'CLONE_SUSPECT' };
      if (dev.status === 'rotated') {
        const until = dev.rotate_expires_at ? dev.rotate_expires_at.getTime() : 0;
        if (nowMs > until) return { allow: false, degraded: false, reason: 'ROTATED_EXPIRED' };
      }
      if (dev.status !== 'active' && dev.status !== 'rotated') {
        return { allow: false, degraded: false, reason: 'UNKNOWN_DEVICE' };
      }

      const verdict = detectCloneSuspect(
        { lastSeenAt: dev.lastSeenAt, lastCountry: dev.last_country, lastCtr: dev.last_ctr },
        { at: now, country: sighting.country ?? null, tokenIatS: sighting.tokenIatS ?? null, ctr: sighting.ctr ?? null },
        now,
      );
      const ipHint = maskIp24(sighting.ip ?? null);
      const evidence = {
        ...(dev.cloned_evidence ?? {}),
        lastSignals: verdict.evidence,
        sightings: [
          ...((dev.cloned_evidence as Record<string, unknown> | null)?.['sightings'] as unknown[] ?? []).slice(-4),
          { at: now.toISOString(), ip_hint: ipHint, country: sighting.country ?? null },
        ],
      };
      if (verdict.suspect) {
        await tx.query(
          `UPDATE license_devices SET cloned_suspect = true, cloned_evidence = $3::jsonb WHERE "licenseId" = $1 AND device_hash = $2`,
          [licenseId, sighting.deviceHash, JSON.stringify({ reasons: verdict.reasons, ...evidence })],
        );
        await insertOutbox(tx as unknown as Q, {
          aggregate: 'LicenseDevice',
          aggregateId: licenseId,
          type: 'DeviceCloneSuspected.v1',
          payload: {
            licenseId,
            device_hash: sighting.deviceHash,
            reasons: verdict.reasons,
            evidence: verdict.evidence,
            at: now.toISOString(),
          },
        });
        // E7 (Fase 9): clone suspeito — trilha best-effort (só sinais; decisão inalterada).
        void emitSecurityEvent(getSecurityEventPool(), {
          type: 'CLONE_SUSPECT',
          entity: 'license',
          entityId: licenseId,
          metadata: { device_hash: sighting.deviceHash, reasons: verdict.reasons },
        });
        return { allow: false, degraded: false, reason: 'CLONE_SUSPECT' };
      }

      const nextCtr =
        typeof sighting.ctr === 'number' ? Math.max(sighting.ctr, dev.last_ctr ?? 0) : dev.last_ctr;
      await tx.query(
        `UPDATE license_devices SET "lastSeenAt" = $3, ip_hint = COALESCE($4, ip_hint),
                last_ctr = $5, last_country = COALESCE($6, last_country),
                cloned_evidence = $7::jsonb
         WHERE "licenseId" = $1 AND device_hash = $2`,
        [
          licenseId,
          sighting.deviceHash,
          now.toISOString(),
          ipHint,
          nextCtr,
          sighting.country ?? null,
          JSON.stringify(evidence),
        ],
      );
      if (dev.status === 'rotated') {
        return { allow: true, degraded, reason: 'DUAL_ACCEPT_ROTATE' };
      }
      return { allow: true, degraded, reason: expMs === null ? 'LIFETIME' : degraded ? 'GRACE' : 'ACTIVE' };
    });
  }
}
