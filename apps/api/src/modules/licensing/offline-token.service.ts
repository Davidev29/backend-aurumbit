import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { mintOfflineToken } from './offline-jwt';
import { LICENSING_POOL } from './licensing-pool.provider';

// Emissão do offline JWT (Fase 3, PROJECT.md §1).
// Exige online + device `active` (não bloqueado, sem clone). off_exp =
// min(iat + 7d, expires + 7d); renovação em grace mantém continuidade.
// Assinatura: stub HS256 local — TODO(KMS): ES256 com `kid` (ver libs/offline-token).

export class OfflineTokenError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type OfflineTokenResponse = {
  token: string;
  kid: string;
  lic_exp: number | null;
  grace_until: number | null;
  off_exp: number;
  token_version: number;
};

function offlineSecret(): string {
  const s = process.env.OFFLINE_TOKEN_SECRET ?? process.env.JWT_SECRET ?? '';
  if (!s) throw new OfflineTokenError('OFFLINE_MISCONFIGURED', 500, 'segredo offline ausente (env/KMS)');
  return s;
}

function offlineIss(): string {
  return process.env.JWT_ISS ?? 'aurum-bit';
}

@Injectable()
export class OfflineTokenService {
  constructor(@Inject(LICENSING_POOL) private readonly pool: Pool) {}

  async mint(licenseId: string, deviceHash: string, now = new Date()): Promise<OfflineTokenResponse> {
    const licRes = await this.pool.query(
      `SELECT id, "ownerId", "productId", status, "expiresAt", "graceUntil", "tokenVersion", features
       FROM licenses WHERE id = $1`,
      [licenseId],
    );
    if (licRes.rows.length === 0) {
      throw new OfflineTokenError('LICENSE_NOT_FOUND', 404, `license ${licenseId} não encontrada`);
    }
    const lic = licRes.rows[0] as Record<string, unknown>;
    const status = String(lic.status);
    if (status === 'revoked') throw new OfflineTokenError('LICENSE_REVOKED', 403, 'licença revogada');
    if (status === 'suspended') throw new OfflineTokenError('LICENSE_SUSPENDED', 403, 'licença suspensa');
    if (status !== 'active') throw new OfflineTokenError('LICENSE_INACTIVE', 403, `licença com status ${status}`);

    const nowMs = now.getTime();
    const expiresAt = lic.expiresAt ? new Date(lic.expiresAt as string) : null;
    const graceUntil = lic.graceUntil ? new Date(lic.graceUntil as string) : null;
    if (expiresAt && graceUntil && nowMs > graceUntil.getTime()) {
      throw new OfflineTokenError('EXPIRED', 403, 'licença além da graça — renovação exige pagamento');
    }
    if (expiresAt && !graceUntil && nowMs > expiresAt.getTime()) {
      throw new OfflineTokenError('EXPIRED', 403, 'licença expirada');
    }

    const devRes = await this.pool.query(
      `SELECT device_hash, status, cloned_suspect, last_ctr FROM license_devices
       WHERE "licenseId" = $1 AND device_hash = $2`,
      [licenseId, deviceHash],
    );
    if (devRes.rows.length === 0) {
      throw new OfflineTokenError('UNKNOWN_DEVICE', 404, 'device não vinculado a esta licença');
    }
    const dev = devRes.rows[0] as Record<string, unknown>;
    if (String(dev.status) === 'blocked') {
      throw new OfflineTokenError('DEVICE_BLOCKED', 403, 'device bloqueado — contate o suporte');
    }
    if (Boolean(dev.cloned_suspect)) {
      throw new OfflineTokenError('CLONE_SUSPECT', 403, 'device com suspeita de clone — revalide online');
    }
    if (String(dev.status) !== 'active') {
      throw new OfflineTokenError('DEVICE_NOT_ACTIVE', 409, `device com status ${String(dev.status)}`);
    }

    const ctr = ((dev.last_ctr as number | null) ?? 0) + 1;
    // Snapshot Fase 8: [{code, channel}] | string[] (legado) | {codes} (legado).
    const rawFeatures = lic.features as unknown;
    let features: string[] = [];
    let channels: Array<'WEB' | 'DESKTOP' | 'BOTH'> = ['BOTH'];
    if (Array.isArray(rawFeatures) && rawFeatures.length > 0 && typeof rawFeatures[0] === 'object') {
      const snap = rawFeatures as Array<{ code?: unknown; channel?: unknown }>;
      features = snap.filter((f) => typeof f.code === 'string').map((f) => f.code as string);
      const chs = snap
        .map((f) => (f.channel === 'WEB' || f.channel === 'DESKTOP' ? f.channel : 'BOTH'))
        .filter((c, i, a) => a.indexOf(c) === i);
      channels = (chs.length > 0 ? chs : ['BOTH']) as Array<'WEB' | 'DESKTOP' | 'BOTH'>;
    } else if (Array.isArray(rawFeatures)) {
      features = (rawFeatures as unknown[]).filter((c): c is string => typeof c === 'string');
    } else if (Array.isArray((rawFeatures as { codes?: unknown } | null)?.codes)) {
      features = ((rawFeatures as { codes: unknown[] }).codes as unknown[]).filter(
        (c): c is string => typeof c === 'string',
      );
    }
    const issued = mintOfflineToken(
      {
        iss: offlineIss(),
        licenseId,
        ownerId: String(lic.ownerId),
        productId: String(lic.productId),
        features,
        channels,
        deviceHash,
        expiresAt,
        graceUntil,
        tokenVersion: Number(lic.tokenVersion ?? 1),
        issuedAt: now,
        ctr,
      },
      offlineSecret(),
    );
    await this.pool.query(
      `UPDATE license_devices SET last_ctr = $3, "lastSeenAt" = $4 WHERE "licenseId" = $1 AND device_hash = $2`,
      [licenseId, deviceHash, ctr, now.toISOString()],
    );
    await this.pool.query(
      `INSERT INTO outbox_events (id, "eventId", aggregate, "aggregateId", type, payload, "occurredAt", published)
       VALUES ($1, $2, 'License', $3, 'OfflineTokenIssued.v1', $4::jsonb, now(), false)`,
      [
        randomUUID(),
        randomUUID(),
        licenseId,
        JSON.stringify({ licenseId, device_hash: deviceHash, ctr, off_exp: issued.claims.off_exp }),
      ],
    );

    return {
      token: issued.token,
      kid: issued.kid,
      lic_exp: issued.claims.lic_exp,
      grace_until: issued.claims.grace_until,
      off_exp: issued.claims.off_exp,
      token_version: issued.claims.tv,
    };
  }
}
