import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { emitSecurityEvent, getSecurityEventPool } from '../audit/security-events';
import { computeDeviceHash, deviceSecret } from './device-hash.util';
import {
  BlockDeviceDto,
  IssueLicenseDto,
  LinkDeviceDto,
  MintOfflineTokenDto,
  OfflineCheckDto,
  RenewLicenseDto,
  RevealLicenseDto,
  RotateLicenseDto,
  RevokeLicenseDto,
  UnlinkDeviceDto,
} from './dto';
import {
  InMemoryLicenseStore,
  LICENSE_STORE,
  LicenseRecord,
  LicenseStore,
} from './license-store';
import {
  decryptLicenseKey,
  encryptLicenseKey,
  generateLicenseKey,
  keyLast4Of,
  keyPrefixOf,
  maskKey,
  sha256HexKey,
} from './license-key.util';
import {
  GRACE_WINDOW_MS,
  addMonthsUTC,
  evaluateOfflineStatus,
  mintOfflineToken,
  parseOfflineToken,
} from './offline-token.util';

export const DEFAULT_MAX_DEVICES = 5;
const REVEAL_WINDOW_MS = 60 * 60 * 1000;
const REVEAL_LIMIT = 10;

export type CheckReason =
  | 'ACTIVE'
  | 'GRACE'
  | 'EXPIRED'
  | 'REVOKED'
  | 'SUSPENDED'
  | 'NOT_FOUND'
  | 'DEVICE_LIMIT'
  | 'DEVICE_BLOCKED'
  // Estendidos (não mapeados — PROJECT.md §1 exige distinguir no cliente):
  // - OFFLINE_EXPIRED / TOKEN_VERSION_MISMATCH: de `evaluateOfflineStatus`
  //   (offline-token.util). OFFLINE_EXPIRED = "exige online"; EXPIRED = "além
  //   da graça, exige pagamento". Fundir os dois quebraria a UX do app.
  // - CLONE_SUSPECT: do fluxo online `devices.service` (PROJECT.md §4).
  | 'OFFLINE_EXPIRED'
  | 'TOKEN_VERSION_MISMATCH'
  | 'CLONE_SUSPECT';

export interface CheckDecision {
  allow: boolean;
  degraded: boolean;
  reason: CheckReason;
  errorCode?: string;
  licenseId: string;
}

export interface LicenseView {
  id: string;
  keyMasked: string;
  keyPrefix: string;
  keyLast4: string;
  // Titular/produto opacos (cross-DB) — expostos p/ orquestração admin
  // (renovar-com-troca resolve owner/product/plan da licença anterior).
  ownerId: string;
  ownerLabel: string | null;
  productId: string;
  planId: string | null;
  status: string;
  startsAt: string;
  expiresAt: string;
  graceUntil: string;
  tokenVersion: number;
  maxDevices: number;
  linkedDevices: number;
}

// Linha mascarada p/ `by-product` (agregado por produto; productId
// obrigatório na rota — sem dump sem filtro). `machinesAllowed/Used`
// espelham maxDevices/linkedDevices (vocabulário da UI).
export interface LicenseProductRow extends LicenseView {
  ownerId: string;
  ownerLabel: string | null;
  productId: string;
  planId: string | null;
  machinesAllowed: number;
  machinesUsed: number;
}

// Entrada do history (`GET /v1/licenses/:id/history`, espelha o BFF
// `LicenseHistoryEntry`). Audit é in-memory até o adaptador PG (Fase 4):
// reiniciar o processo zera a trilha.
export interface LicenseHistoryEntry {
  licenseId: string;
  keyMasked: string;
  status: string;
  reason: string | null;
  endedAt: string | null;
  replacedBy: string | null;
}

// Serviço de fluxo de licenças (Fase 3). Emite AuditEvent explícito com
// SÓ keyMasked/device_hash (LGPD.md). Persistência via LICENSE_STORE
// (memória na Fase 3; PG + FOR UPDATE na Fase 4).
@Injectable()
export class LicensingFlowService {
  // Token-bucket de revelação 10/h por ator (espelha
  // libs/security RATE_LIMITS.licenseReveal; autocontido p/ nest build).
  private readonly revealHits = new Map<string, number[]>();

  constructor(
    @Inject(LICENSE_STORE) private readonly store: LicenseStore,
    private readonly audit: AuditService,
  ) {}

  // --- helpers ---------------------------------------------------------

  private nowMs(queryNow?: string): number {
    if (queryNow === undefined) return Date.now();
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('âncora de tempo explícita indisponível em produção');
    }
    const t = Date.parse(queryNow);
    if (Number.isNaN(t)) throw new BadRequestException('now/paidAt/iat inválido (ISO-8601)');
    return t;
  }

  private monthsBetween(startIso: string, endIso: string): number {
    const s = new Date(startIso);
    const e = new Date(endIso);
    const m = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
    return m === 12 ? 12 : 1;
  }

  private view(rec: LicenseRecord): LicenseView {
    return {
      id: rec.id,
      keyMasked: `AURUM-••••-••••-${rec.keyLast4}`,
      keyPrefix: rec.keyPrefix,
      keyLast4: rec.keyLast4,
      ownerId: rec.ownerId,
      ownerLabel: rec.ownerLabel,
      productId: rec.productId,
      planId: rec.planId,
      status: rec.status,
      startsAt: rec.startsAt,
      expiresAt: rec.expiresAt,
      graceUntil: rec.graceUntil,
      tokenVersion: rec.tokenVersion,
      maxDevices: rec.maxDevices,
      linkedDevices: rec.devices.size,
    };
  }

  private require(id: string): LicenseRecord {
    const rec = this.store.get(id);
    if (!rec) throw new NotFoundException({ code: 'NOT_FOUND', message: `license ${id} não encontrada` });
    return rec;
  }

  // --- issue -----------------------------------------------------------

  async issue(dto: IssueLicenseDto): Promise<LicenseView & { key: string }> {
    const months = dto.months ?? 1;
    if (months !== 1 && months !== 12) throw new BadRequestException('months deve ser 1 ou 12');
    const start = new Date(this.nowMs(dto.paidAt));
    const expires = addMonthsUTC(start, months);
    const grace = new Date(expires.getTime() + GRACE_WINDOW_MS);
    let rec: LicenseRecord | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const key = generateLicenseKey();
      const keyHash = sha256HexKey(key);
      if (this.store.getByKeyHash(keyHash)) continue;
      try {
        rec = this.store.create({
          ownerId: dto.ownerId,
          ownerLabel: dto.ownerLabel ?? null,
          productId: dto.productId,
          planId: dto.planId ?? null,
          keyHash,
          keyPrefix: keyPrefixOf(key),
          keyLast4: keyLast4Of(key),
          keyEnc: encryptLicenseKey(key),
          status: 'active',
          startsAt: start.toISOString(),
          expiresAt: expires.toISOString(),
          graceUntil: grace.toISOString(),
          tokenVersion: 1,
          maxDevices: dto.maxDevices ?? DEFAULT_MAX_DEVICES,
          devices: new Map(),
          blockedDevices: new Set(),
        });
      } catch (e) {
        // Colisão de key_hash (CSPRNG12): regenera. Outro erro propaga.
        if (e instanceof ConflictException) continue;
        throw e;
      }
      const issuedKey = decryptLicenseKey(rec.keyEnc);
      this.audit.emit({
        actorId: dto.actor,
        action: 'license.issue',
        entity: 'license',
        entityId: rec.id,
        metadata: { keyMasked: maskKey(issuedKey), months },
      });
      return { ...this.view(rec), key: issuedKey };
    }
    throw new HttpException(
      { code: 'INTERNAL', message: 'falha ao gerar chave única' },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // --- renew (em grace, sem lacuna) ------------------------------------

  async renew(id: string, dto: RenewLicenseDto): Promise<LicenseView> {
    const rec = this.require(id);
    if (rec.status === 'revoked') {
      throw new HttpException(
        { code: 'LICENSE_REVOKED', message: 'licença revogada não pode ser renovada' },
        HttpStatus.CONFLICT,
      );
    }
    const nowMs = this.nowMs(dto.now);
    const prevExpMs = Date.parse(rec.expiresAt);
    // Continuidade: starts_at = max(now, expires_at anterior) — sem lacuna nem sobreposição.
    const start = new Date(Math.max(nowMs, prevExpMs));
    const months = dto.months ?? this.monthsBetween(rec.startsAt, rec.expiresAt);
    const expires = addMonthsUTC(start, months);
    rec.startsAt = start.toISOString();
    rec.expiresAt = expires.toISOString();
    rec.graceUntil = new Date(expires.getTime() + GRACE_WINDOW_MS).toISOString();
    rec.status = 'active';
    this.store.save(rec);
    this.audit.emit({
      actorId: dto.actor,
      action: 'license.renew',
      entity: 'license',
      entityId: rec.id,
      metadata: { keyMasked: this.view(rec).keyMasked, months },
    });
    return this.view(rec);
  }

  // --- revoke (bump token_version) -------------------------------------

  async revoke(id: string, dto: RevokeLicenseDto): Promise<LicenseView> {
    const rec = this.require(id);
    rec.status = 'revoked';
    rec.tokenVersion += 1;
    this.store.save(rec);
    this.audit.emit({
      actorId: dto.actor,
      action: 'license.revoke',
      entity: 'license',
      entityId: rec.id,
      metadata: {
        keyMasked: this.view(rec).keyMasked,
        reason: dto.reason,
        ...(dto.replacedBy ? { replacedBy: dto.replacedBy } : {}),
      },
    });
    return this.view(rec);
  }

  // --- reveal / rotate ---------------------------------------------------

  getMasked(id: string): LicenseView {
    return this.view(this.require(id));
  }

  // --- by-product / history (leituras admin p/ o BFF) --------------------

  /** Licenças mascaradas de um produto (productId obrigatório — sem dump). */
  listByProduct(productId: string): LicenseProductRow[] {
    return this.store.listByProduct(productId).map((rec) => ({
      ...this.view(rec),
      ownerId: rec.ownerId,
      ownerLabel: rec.ownerLabel,
      productId: rec.productId,
      planId: rec.planId,
      machinesAllowed: rec.maxDevices,
      machinesUsed: rec.devices.size,
    }));
  }

  /**
   * Histórico da licença a partir da trilha `audit.listByEntity`.
   * Cobre issue/renew/revoke/reveal (+ rotate); `endedAt` = momento em que
   * a linha terminou (revoke) — null nas linhas ainda vigentes.
   */
  getHistory(id: string): LicenseHistoryEntry[] {
    const rec = this.require(id);
    const maskedNow = this.view(rec).keyMasked;
    return this.audit.listByEntity('license', id).map((ev) => {
      const meta = ev.metadata as Record<string, unknown>;
      const keyMasked = typeof meta.keyMasked === 'string' ? meta.keyMasked : maskedNow;
      const reason = typeof meta.reason === 'string' ? meta.reason : null;
      const replacedBy = typeof meta.replacedBy === 'string' ? meta.replacedBy : null;
      switch (ev.action) {
        case 'license.issue':
        case 'license.renew':
          return { licenseId: id, keyMasked, status: 'active', reason, endedAt: null, replacedBy };
        case 'license.revoke':
          return { licenseId: id, keyMasked, status: 'revoked', reason, endedAt: ev.createdAt, replacedBy };
        default:
          return { licenseId: id, keyMasked, status: rec.status, reason, endedAt: null, replacedBy };
      }
    });
  }

  reveal(id: string, dto: RevealLicenseDto): { id: string; key: string; keyMasked: string } {
    const rec = this.require(id);
    const now = Date.now();
    const hits = (this.revealHits.get(dto.actor) ?? []).filter((t) => t > now - REVEAL_WINDOW_MS);
    if (hits.length >= REVEAL_LIMIT) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'limite de revelação excedido (10/h por ator)' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    hits.push(now);
    this.revealHits.set(dto.actor, hits);
    const key = decryptLicenseKey(rec.keyEnc);
    this.audit.emit({
      actorId: dto.actor,
      action: 'license.reveal',
      entity: 'license',
      entityId: rec.id,
      metadata: { keyMasked: maskKey(key), reason: dto.reason },
    });
    // E7 (Fase 9): revelação — trilha best-effort com SÓ keyMasked (sem motivo/chave).
    void emitSecurityEvent(getSecurityEventPool(), {
      type: 'KEY_REVEALED',
      actorId: dto.actor,
      entity: 'license',
      entityId: rec.id,
      metadata: { keyMasked: maskKey(key) },
    });
    return { id: rec.id, key, keyMasked: maskKey(key) };
  }

  rotate(id: string, dto: RotateLicenseDto): LicenseView & { key: string } {
    const rec = this.require(id);
    if (rec.status === 'revoked') {
      throw new HttpException(
        { code: 'LICENSE_REVOKED', message: 'licença revogada não pode ser rotacionada' },
        HttpStatus.CONFLICT,
      );
    }
    const mem = this.store as InMemoryLicenseStore;
    for (let attempt = 0; attempt < 3; attempt++) {
      const key = generateLicenseKey();
      const keyHash = sha256HexKey(key);
      if (this.store.getByKeyHash(keyHash)) continue;
      const oldHash = rec.keyHash;
      rec.keyHash = keyHash;
      rec.keyPrefix = keyPrefixOf(key);
      rec.keyLast4 = keyLast4Of(key);
      rec.keyEnc = encryptLicenseKey(key);
      rec.tokenVersion += 1;
      this.store.save(rec);
      mem.reindexKeyHash(rec, oldHash);
      this.audit.emit({
        actorId: dto.actor,
        action: 'license.rotate',
        entity: 'license',
        entityId: rec.id,
        metadata: { keyMasked: maskKey(key), reason: dto.reason },
      });
      return { ...this.view(rec), key };
    }
    throw new HttpException(
      { code: 'INTERNAL', message: 'falha ao gerar chave única' },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // --- devices (limite backend, 409) -------------------------------------

  linkDevice(id: string, dto: LinkDeviceDto): { deviceHash: string; linkedAt: string } {
    const rec = this.require(id);
    const appInstanceId = dto.appInstanceId;
    const hash = appInstanceId
      ? computeDeviceHash(deviceSecret(), rec.id, appInstanceId)
      : dto.deviceHash;
    if (!hash) {
      throw new BadRequestException('informe app_instance_id ou device_hash hex 64');
    }
    if (rec.blockedDevices.has(hash)) {
      throw new HttpException(
        { code: 'DEVICE_BLOCKED', message: 'dispositivo bloqueado' },
        HttpStatus.FORBIDDEN,
      );
    }
    const existing = rec.devices.get(hash);
    if (existing) {
      existing.lastSeenAt = new Date().toISOString();
      this.store.save(rec);
      return { deviceHash: hash, linkedAt: existing.linkedAt };
    }
    if (rec.devices.size >= rec.maxDevices) {
      throw new HttpException(
        { code: 'DEVICE_LIMIT', message: `limite de ${rec.maxDevices} dispositivos atingido` },
        HttpStatus.CONFLICT,
      );
    }
    const now = new Date().toISOString();
    rec.devices.set(hash, { deviceHash: hash, linkedAt: now, lastSeenAt: now });
    this.store.save(rec);
    this.audit.emit({
      action: 'device.link',
      entity: 'license',
      entityId: rec.id,
      metadata: { device_hash: hash },
    });
    return { deviceHash: hash, linkedAt: now };
  }

  unlinkDevice(id: string, dto: UnlinkDeviceDto): { deviceHash: string; unlinked: boolean } {
    const rec = this.require(id);
    const hash = dto.appInstanceId
      ? computeDeviceHash(deviceSecret(), rec.id, dto.appInstanceId)
      : dto.deviceHash;
    if (!hash) {
      throw new BadRequestException('informe app_instance_id ou device_hash hex 64');
    }
    const unlinked = rec.devices.delete(hash);
    this.store.save(rec);
    this.audit.emit({
      action: 'device.unlink',
      entity: 'license',
      entityId: rec.id,
      metadata: { device_hash: hash },
    });
    return { deviceHash: hash, unlinked };
  }

  blockDevice(id: string, dto: BlockDeviceDto): { deviceHash: string; blocked: boolean } {
    const rec = this.require(id);
    if (!dto.deviceHash) {
      throw new BadRequestException('device_hash ausente (rota /:hash/block usa o parâmetro da URL)');
    }
    rec.devices.delete(dto.deviceHash);
    rec.blockedDevices.add(dto.deviceHash);
    this.store.save(rec);
    this.audit.emit({
      actorId: dto.actor,
      action: 'device.block',
      entity: 'license',
      entityId: rec.id,
      metadata: { device_hash: dto.deviceHash, reason: dto.reason },
    });
    return { deviceHash: dto.deviceHash, blocked: true };
  }

  // --- check online ------------------------------------------------------

  check(id: string, deviceHash?: string, queryNow?: string): CheckDecision {
    const rec = this.store.get(id);
    if (!rec) {
      return { allow: false, degraded: false, reason: 'NOT_FOUND', errorCode: 'NOT_FOUND', licenseId: id };
    }
    const nowMs = this.nowMs(queryNow);
    if (rec.status === 'revoked') {
      return { allow: false, degraded: false, reason: 'REVOKED', errorCode: 'REVOKED', licenseId: id };
    }
    if (rec.status === 'suspended') {
      return { allow: false, degraded: false, reason: 'SUSPENDED', errorCode: 'SUSPENDED', licenseId: id };
    }
    const expMs = Date.parse(rec.expiresAt);
    const graceMs = Date.parse(rec.graceUntil);
    if (nowMs > graceMs) {
      return { allow: false, degraded: false, reason: 'EXPIRED', errorCode: 'EXPIRED', licenseId: id };
    }
    if (deviceHash) {
      if (rec.blockedDevices.has(deviceHash)) {
        return {
          allow: false,
          degraded: false,
          reason: 'DEVICE_BLOCKED',
          errorCode: 'DEVICE_BLOCKED',
          licenseId: id,
        };
      }
      if (!rec.devices.has(deviceHash) && rec.devices.size >= rec.maxDevices) {
        return {
          allow: false,
          degraded: false,
          reason: 'DEVICE_LIMIT',
          errorCode: 'DEVICE_LIMIT',
          licenseId: id,
        };
      }
    }
    if (nowMs <= expMs) {
      return { allow: true, degraded: false, reason: 'ACTIVE', licenseId: id };
    }
    return { allow: true, degraded: true, reason: 'GRACE', licenseId: id };
  }

  // --- offline-token (servidor: mint + conferência) ------------------------

  mintOffline(id: string, dto: MintOfflineTokenDto, queryNow?: string): { token: string; offExp: string } {
    const rec = this.require(id);
    if (rec.status === 'revoked') {
      throw new HttpException(
        { code: 'LICENSE_REVOKED', message: 'licença revogada não emite offline-token' },
        HttpStatus.CONFLICT,
      );
    }
    if (dto.deviceHash && rec.blockedDevices.has(dto.deviceHash)) {
      throw new HttpException(
        { code: 'DEVICE_BLOCKED', message: 'dispositivo bloqueado' },
        HttpStatus.FORBIDDEN,
      );
    }
    const iatMs = dto.iat ? this.nowMs(dto.iat) : this.nowMs(queryNow);
    const { token, offExpMs } = mintOfflineToken({
      licenseId: rec.id,
      tokenVersion: rec.tokenVersion,
      iatMs,
      expiresAtMs: Date.parse(rec.expiresAt),
      graceUntilMs: Date.parse(rec.graceUntil),
    });
    return { token, offExp: new Date(offExpMs).toISOString() };
  }

  checkOffline(dto: OfflineCheckDto): CheckDecision & { licenseId: string } {
    let payload;
    try {
      payload = parseOfflineToken(dto.token);
    } catch {
      throw new HttpException(
        { code: 'BAD_REQUEST', message: 'offline-token inválido' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const rec = this.store.get(payload.lid);
    if (!rec) {
      return { allow: false, degraded: false, reason: 'NOT_FOUND', errorCode: 'NOT_FOUND', licenseId: payload.lid };
    }
    const nowMs = this.nowMs(dto.now);
    const decision = evaluateOfflineStatus({
      nowMs,
      licExpMs: payload.exp,
      graceUntilMs: payload.grace,
      offExpMs: payload.off,
      status: rec.status,
      tokenVersion: payload.tv,
      expectedTokenVersion: rec.tokenVersion,
    });
    return { ...decision, licenseId: rec.id };
  }
}
