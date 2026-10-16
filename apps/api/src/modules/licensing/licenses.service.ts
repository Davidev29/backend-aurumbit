import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { LICENSING_POOL } from './licensing-pool.provider';
import { emitSecurityEvent, getSecurityEventPool } from '../audit/security-events';
import {
  LicenseKind,
  calcExpiry,
  decryptLicenseKey,
  effectiveStatus,
  encryptLicenseKey,
  generateLicenseKey,
  kindForBillingInterval,
  maskFromParts,
  sha256Hex,
} from './license-keys';
import { IssueLicenseDto, IssueTrialDto } from './licenses.dto';

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

export type LicenseRow = {
  id: string;
  ownerType: string;
  ownerId: string;
  ownerLabel: string | null;
  productId: string;
  planId: string | null;
  contractItemId: string | null;
  kind: string;
  status: string;
  key_hash: string;
  key_prefix: string;
  key_last4: string;
  key_enc: string | null;
  tokenVersion: number;
  issuedAt: Date;
  startsAt: Date | null;
  expiresAt: Date | null;
  graceUntil: Date | null;
  features: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/** Resposta pública: sempre mascarada, nunca hash/plaintext/key_enc. */
export type MaskedLicense = Omit<LicenseRow, 'key_hash' | 'key_enc' | 'status'> & {
  status: string; // efetivo (grace/expired derivados — PROJECT.md §1)
  keyMasked: string;
};

const SELECT_COLS = `id, "ownerType", "ownerId", "ownerLabel", "productId", "planId", "contractItemId",
  kind, status, key_hash, key_prefix, key_last4, key_enc, "tokenVersion",
  "issuedAt", "startsAt", "expiresAt", "graceUntil", features, "createdAt", "updatedAt"`;

/** Snapshot {code, channel} canônico (dedup por code, channel fora do trio → BOTH). */
export type FeatureSnapshot = Array<{ code: string; channel: 'WEB' | 'DESKTOP' | 'BOTH' }>;

export function normalizeFeatureSnapshot(
  input: Array<{ code?: unknown; channel?: unknown }> | undefined,
): FeatureSnapshot {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: FeatureSnapshot = [];
  for (const f of input) {
    const code = typeof f?.code === 'string' ? f.code.trim() : '';
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const ch = f?.channel;
    out.push({ code, channel: ch === 'WEB' || ch === 'DESKTOP' ? ch : 'BOTH' });
  }
  return out;
}

/** Snapshot bruto do banco → canônico (legado NULL/string[] tolerado). */
export function snapshotFromRow(v: unknown): FeatureSnapshot {
  if (!Array.isArray(v)) return [];
  return normalizeFeatureSnapshot(v as Array<{ code?: unknown; channel?: unknown }>);
}

// Outbox emitida pelo licensing. O consumidor Access cria Entitlement
// origin=license (só emitimos; lado access NÃO implementado aqui).
export const LICENSE_OUTBOX_TYPES = [
  'LicenseIssued',
  'LicenseRenewed',
  'LicenseRevoked',
  'LicenseSuspended',
] as const;

// Fase 3 — Licensing core. Pool PG próprio (DATABASE_URL_LICENSING);
// sem acesso a outros domínios. Toda mutação insere o OutboxEvent na
// mesma transação (relay publica; consumidores idempotentes por eventId).
@Injectable()
export class LicensesService {
  constructor(@Inject(LICENSING_POOL) private readonly pool: Pool) {}

  toMasked(row: LicenseRow, now = new Date()): MaskedLicense {
    const { key_hash: _h, key_enc: _e, ...rest } = row;
    return { ...rest, status: effectiveStatus(row, now), keyMasked: maskFromParts(row.key_last4) };
  }

  async listLicenses(
    ownerType: string | undefined,
    ownerId: string | undefined,
    filters: { productId?: string; status?: string },
    now = new Date(),
  ): Promise<MaskedLicense[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    // Sem dump sem filtro: exige ao menos um filtro (titular e/ou produto).
    if (ownerType) {
      params.push(ownerType);
      conds.push(`"ownerType" = $${params.length}`);
    }
    if (ownerId) {
      params.push(ownerId);
      conds.push(`"ownerId" = $${params.length}`);
    }
    if (filters.productId) {
      params.push(filters.productId);
      conds.push(`"productId" = $${params.length}`);
    }
    if (conds.length === 0) {
      throw new BadRequestException('listagem exige ao menos um filtro (ownerType/ownerId/productId)');
    }
    const { rows } = await this.pool.query(
      `SELECT ${SELECT_COLS} FROM licenses WHERE ${conds.join(' AND ')} ORDER BY "createdAt" DESC LIMIT 200`,
      params,
    );
    let out = (rows as LicenseRow[]).map((r) => this.toMasked(r, now));
    if (filters.status) out = out.filter((l) => l.status === filters.status);
    return out;
  }

  async getLicense(id: string, now = new Date()): Promise<MaskedLicense> {
    const { rows } = await this.pool.query(`SELECT ${SELECT_COLS} FROM licenses WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException(`license ${id} não encontrada`);
    return this.toMasked(rows[0] as LicenseRow, now);
  }

  /**
   * Busca por hash SHA256 da chave (ativação por chave). Retorna a licença
   * mascarada ou null — o chamador mapeia null para 404 genérico (anti-enumeração).
   */
  async findByKeyHash(keyHash: string, now = new Date()): Promise<MaskedLicense | null> {
    const { rows } = await this.pool.query(`SELECT ${SELECT_COLS} FROM licenses WHERE key_hash = $1`, [
      keyHash,
    ]);
    if (rows.length === 0) return null;
    return this.toMasked(rows[0] as LicenseRow, now);
  }

  /**
   * Histórico da licença a partir do outbox PG (append-only): emissão,
   * renovações, suspensões e revogações com motivo/sucessora. Antigas nunca
   * são apagadas — a renovação-com-troca preserva a anterior aqui.
   * Espelha `LicenseHistoryEntry` do BFF admin.
   */
  async licenseHistory(id: string): Promise<
    Array<{
      licenseId: string;
      keyMasked: string;
      status: string;
      reason: string | null;
      endedAt: string | null;
      replacedBy: string | null;
    }>
  > {
    const row = await this.loadRow(id);
    const keyMasked = maskFromParts(row.key_last4);
    const { rows } = await this.pool.query(
      `SELECT type, payload, "occurredAt" FROM outbox_events
       WHERE "aggregateId" = $1 AND type IN ('LicenseIssued','LicenseRenewed','LicenseSuspended','LicenseRevoked')
       ORDER BY "occurredAt" ASC`,
      [id],
    );
    return (rows as Array<{ type: string; payload: unknown; occurredAt: Date }>).map((e) => {
      const meta = (e.payload ?? {}) as { reason?: unknown; replacedBy?: unknown };
      const reason = typeof meta.reason === 'string' ? meta.reason : null;
      const replacedBy = typeof meta.replacedBy === 'string' ? meta.replacedBy : null;
      const endedAt = e.occurredAt instanceof Date ? e.occurredAt.toISOString() : String(e.occurredAt ?? '');
      switch (e.type) {
        case 'LicenseRevoked':
          return { licenseId: id, keyMasked, status: 'revoked', reason, endedAt, replacedBy };
        case 'LicenseSuspended':
          return { licenseId: id, keyMasked, status: 'suspended', reason, endedAt, replacedBy: null };
        case 'LicenseRenewed':
          return { licenseId: id, keyMasked, status: 'active', reason: null, endedAt: null, replacedBy: null };
        default:
          return { licenseId: id, keyMasked, status: 'active', reason: null, endedAt: null, replacedBy: null };
      }
    });
  }

  /**
   * Emite licença (admin/system). Retorna a chave em plaintext UMA vez
   * (entrega ao titular); leituras posteriores só mascaradas ou via
   * reveal auditado. startsAt explícito por ora; hook PaymentConfirmed
   * (starts_at = confirmação) entra na Fase 4 (billing).
   */
  async issueLicense(dto: IssueLicenseDto, actor: string, now = new Date()): Promise<{ license: MaskedLicense; key: string }> {
    const kind = dto.kind as LicenseKind;
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : now;
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('startsAt inválido (ISO-8601).');
    const { expiresAt, graceUntil } = calcExpiry(startsAt, kind);
    const features = normalizeFeatureSnapshot(dto.features);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let attempt = 0; attempt < 3; attempt++) {
        const key = generateLicenseKey();
        const keyHash = sha256Hex(key);
        try {
          const { rows } = await client.query(
            `INSERT INTO licenses (id, "ownerType", "ownerId", "ownerLabel", "productId", "planId", "contractItemId",
              kind, status, key_hash, key_prefix, key_last4, key_enc, "tokenVersion",
              "issuedAt", "startsAt", "expiresAt", "graceUntil", features, "createdAt", "updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,1,now(),$13,$14,$15,$16,now(),now())
             RETURNING ${SELECT_COLS}`,
            [
              randomUUID(), dto.ownerType, dto.ownerId, dto.ownerLabel ?? null, dto.productId, dto.planId ?? null,
              dto.contractItemId ?? null, kind, keyHash, key.slice(6, 10), key.slice(-4),
              encryptLicenseKey(key), startsAt, expiresAt, graceUntil,
              features.length > 0 ? JSON.stringify(features) : null,
            ],
          );
          const row = rows[0] as LicenseRow;
          await this.insertOutbox(client, row.id, 'LicenseIssued', {
            licenseId: row.id,
            ownerType: row.ownerType,
            ownerId: row.ownerId,
            ownerLabel: row.ownerLabel,
            productId: row.productId,
            planId: row.planId,
            contractItemId: row.contractItemId,
            kind: row.kind,
            startsAt: row.startsAt?.toISOString() ?? null,
            expiresAt: row.expiresAt?.toISOString() ?? null,
            graceUntil: row.graceUntil?.toISOString() ?? null,
            featureCodes: features.map((f) => f.code),
            channels: features.map((f) => f.channel),
            actor,
          });
          await client.query('COMMIT');
          return { license: this.toMasked(row, now), key };
        } catch (e) {
          if (isUniqueViolation(e)) continue; // colisão de key_hash (60-bit display): regenera
          throw e;
        }
      }
      throw new ConflictException('não foi possível gerar chave única; tente novamente');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Renova criando NOVA licença (nova chave). Sem lacuna em grace:
   * starts_at = max(now, expires_at anterior) — renovação dentro da
   * graça continua exatamente do vencimento (PROJECT.md §1).
   * A licença anterior é preservada (trilha); o consumidor Access
   * resolve prioridade/vigência pelos Entitlements.
   */
  async renewLicense(id: string, kindOverride: string | undefined, actor: string, now = new Date()): Promise<{ license: MaskedLicense; key: string; previousLicenseId: string }> {
    const prev = await this.loadRow(id);
    if (prev.status === 'revoked') throw new ConflictException('licença revogada não pode ser renovada');
    // Fase 8: vitalícia não renova (não expira). Downgrade lifetime → mensal/
    // anual = revogar + emitir nova (auditoria explícita, sem reescrever kind).
    if (prev.kind === 'lifetime') throw new ConflictException({ code: 'LIFETIME_NO_RENEW', message: 'licença vitalícia não precisa de renovação' });
    if (prev.status === 'pending_payment') throw new ConflictException('licença pendente de pagamento não pode ser renovada');
    if (prev.status === 'suspended') throw new ConflictException('licença suspensa: retome antes de renovar');
    if (!prev.expiresAt) throw new ConflictException('licença sem expiração não pode ser renovada');
    const kind = (kindOverride ?? prev.kind) as LicenseKind;
    const startsAt = new Date(Math.max(now.getTime(), prev.expiresAt.getTime()));
    const { expiresAt, graceUntil } = calcExpiry(startsAt, kind);
    const features = snapshotFromRow(prev.features);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let attempt = 0; attempt < 3; attempt++) {
        const key = generateLicenseKey();
        try {
          const { rows } = await client.query(
            `INSERT INTO licenses (id, "ownerType", "ownerId", "ownerLabel", "productId", "planId", "contractItemId",
              kind, status, key_hash, key_prefix, key_last4, key_enc, "tokenVersion",
              "issuedAt", "startsAt", "expiresAt", "graceUntil", features, "createdAt", "updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,1,now(),$13,$14,$15,$16,now(),now())
             RETURNING ${SELECT_COLS}`,
            [
              randomUUID(), prev.ownerType, prev.ownerId, prev.ownerLabel, prev.productId, prev.planId,
              prev.contractItemId, kind, sha256Hex(key), key.slice(6, 10), key.slice(-4),
              encryptLicenseKey(key), startsAt, expiresAt, graceUntil,
              features.length > 0 ? JSON.stringify(features) : null,
            ],
          );
          const row = rows[0] as LicenseRow;
          await this.insertOutbox(client, row.id, 'LicenseRenewed', {
            licenseId: row.id,
            previousLicenseId: prev.id,
            ownerType: row.ownerType,
            ownerId: row.ownerId,
            ownerLabel: row.ownerLabel,
            productId: row.productId,
            kind: row.kind,
            startsAt: row.startsAt?.toISOString() ?? null,
            expiresAt: row.expiresAt?.toISOString() ?? null,
            featureCodes: features.map((f) => f.code),
            channels: features.map((f) => f.channel),
            actor,
          });
          await client.query('COMMIT');
          return { license: this.toMasked(row, now), key, previousLicenseId: prev.id };
        } catch (e) {
          if (isUniqueViolation(e)) continue;
          throw e;
        }
      }
      throw new ConflictException('não foi possível gerar chave única; tente novamente');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async suspendLicense(id: string, reason: string, actor: string): Promise<MaskedLicense> {
    const prev = await this.loadRow(id);
    const eff = effectiveStatus(prev);
    if (prev.status === 'revoked') throw new ConflictException('licença revogada não pode ser suspensa');
    if (prev.status === 'suspended') throw new ConflictException('licença já suspensa');
    if (prev.status === 'pending_payment') throw new ConflictException('licença pendente não pode ser suspensa');
    if (eff === 'expired') throw new ConflictException('licença expirada não pode ser suspensa (renove)');
    return this.mutate(id, `UPDATE licenses SET status = 'suspended', "updatedAt" = now() WHERE id = $1 RETURNING ${SELECT_COLS}`, 'LicenseSuspended', { reason, actor });
  }

  /** Retoma suspensa (sem outbox — tipos emitidos: Issued/Renewed/Revoked/Suspended). */
  async resumeLicense(id: string, reason: string): Promise<MaskedLicense> {
    const prev = await this.loadRow(id);
    if (prev.status !== 'suspended') throw new ConflictException('só licença suspensa pode ser retomada');
    void reason;
    const { rows } = await this.pool.query(
      `UPDATE licenses SET status = 'active', "updatedAt" = now() WHERE id = $1 RETURNING ${SELECT_COLS}`,
      [id],
    );
    return this.toMasked(rows[0] as LicenseRow);
  }

  /**
   * Revoga: bump token_version (invalida JWTs/offline-tokens no próximo
   * online — PROJECT.md §2) + outbox LicenseRevoked.
   */
  async revokeLicense(
    id: string,
    reason: string,
    actor: string,
    replacedBy?: string,
  ): Promise<MaskedLicense> {
    const prev = await this.loadRow(id);
    if (prev.status === 'revoked') throw new ConflictException('licença já revogada');
    return this.mutate(
      id,
      `UPDATE licenses SET status = 'revoked', "tokenVersion" = "tokenVersion" + 1, "updatedAt" = now() WHERE id = $1 RETURNING ${SELECT_COLS}`,
      'LicenseRevoked',
      { reason, actor, tokenVersion: prev.tokenVersion + 1, ...(replacedBy ? { replacedBy } : {}) },
    );
  }

  /**
   * Revela o plaintext UMA vez (PROJECT.md §2). Guardas: license.read +
   * MFA se admin + rate-limit 10/h. Sem key_enc (segredo ausente) → 409.
   * A trilha `license.reveal` é registrada pelo controller (ator/motivo).
   */
  async revealKey(id: string): Promise<{ licenseId: string; key: string; keyMasked: string }> {
    const row = await this.loadRow(id);
    if (!row.key_enc) {
      throw new ConflictException('chave não recuperável (cifra indisponível nesta instância)');
    }
    let key: string;
    try {
      key = decryptLicenseKey(row.key_enc);
    } catch {
      throw new ConflictException('chave não recuperável (falha de decifração)');
    }
    const out = { licenseId: row.id, key, keyMasked: maskFromParts(row.key_last4) };
    // E7 (Fase 9): revelação PG — trilha best-effort com SÓ keyMasked (decisão/guards inalterados).
    void emitSecurityEvent(getSecurityEventPool(), {
      type: 'KEY_REVEALED',
      entity: 'license',
      entityId: row.id,
      metadata: { keyMasked: out.keyMasked },
    });
    return out;
  }

  /**
   * Emissão a partir de PaymentConfirmed (Fase 8, Asaas→licença).
   * Claim-first: reserva `lic-claim:<eventId>` no outbox (ON CONFLICT DO
   * NOTHING) ANTES de inserir — replay do mesmo pagamento retorna
   * `{duplicate:true}` sem 2ª licença/chave. Vigência = confirmação
   * (`startsAt = paidAt`, PROJECT.md §5); kind deriva do billingInterval
   * (MONTH→monthly, YEAR→annual, ONE_TIME→lifetime).
   */
  async issueFromPayment(
    input: {
      eventId: string;
      paymentId: string;
      externalId: string;
      orderId?: string;
      ownerType: string;
      ownerId: string;
      ownerLabel?: string;
      productId: string;
      planId?: string;
      billingInterval: string;
      paidAt: string;
      amountCents: number;
      features?: Array<{ code?: unknown; channel?: unknown }>;
      actor: string;
    },
    now = new Date(),
  ): Promise<{ duplicate: boolean; license?: MaskedLicense; key?: string }> {
    const kind = kindForBillingInterval(input.billingInterval);
    const startsAt = new Date(input.paidAt);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('paidAt inválido (ISO-8601).');
    const features = normalizeFeatureSnapshot(input.features);
    const { expiresAt, graceUntil } = calcExpiry(startsAt, kind);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // 1. Claim idempotente (dedupe físico do pagamento).
      const claim = await client.query(
        `INSERT INTO outbox_events (id, "eventId", aggregate, "aggregateId", type, payload, "occurredAt", published, "createdAt")
         VALUES ($1,$2,'LicensePayment',$3,'LicenseIssueClaim',$4,now(),false,now())
         ON CONFLICT ("eventId") DO NOTHING`,
        [
          randomUUID(),
          `lic-claim:${input.eventId}`,
          input.paymentId,
          JSON.stringify({ paymentId: input.paymentId, externalId: input.externalId, orderId: input.orderId ?? null }),
        ],
      );
      if ((claim.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return { duplicate: true };
      }
      // 2. Emissão (mesma base do issueLicense, startsAt = paidAt).
      for (let attempt = 0; attempt < 3; attempt++) {
        const key = generateLicenseKey();
        const keyHash = sha256Hex(key);
        try {
          const { rows } = await client.query(
            `INSERT INTO licenses (id, "ownerType", "ownerId", "ownerLabel", "productId", "planId", "contractItemId",
              kind, status, key_hash, key_prefix, key_last4, key_enc, "tokenVersion",
              "issuedAt", "startsAt", "expiresAt", "graceUntil", features, "createdAt", "updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,'active',$8,$9,$10,$11,1,now(),$12,$13,$14,$15,now(),now())
             RETURNING ${SELECT_COLS}`,
            [
              randomUUID(), input.ownerType, input.ownerId, input.ownerLabel ?? null,
              input.productId, input.planId ?? null, kind, keyHash, key.slice(6, 10), key.slice(-4),
              encryptLicenseKey(key), startsAt, expiresAt, graceUntil,
              features.length > 0 ? JSON.stringify(features) : null,
            ],
          );
          const row = rows[0] as LicenseRow;
          await this.insertOutbox(client, row.id, 'LicenseIssued', {
            licenseId: row.id,
            ownerType: row.ownerType,
            ownerId: row.ownerId,
            productId: row.productId,
            planId: row.planId,
            kind: row.kind,
            startsAt: row.startsAt?.toISOString() ?? null,
            expiresAt: row.expiresAt?.toISOString() ?? null,
            graceUntil: row.graceUntil?.toISOString() ?? null,
            featureCodes: features.map((f) => f.code),
            channels: features.map((f) => f.channel),
            paymentId: input.paymentId,
            externalId: input.externalId,
            orderId: input.orderId ?? null,
            amountCents: input.amountCents,
            actor: input.actor,
          });
          await client.query('COMMIT');
          return { duplicate: false, license: this.toMasked(row, now), key };
        } catch (e) {
          if (isUniqueViolation(e)) continue; // colisão de key_hash: regenera
          throw e;
        }
      }
      throw new ConflictException('não foi possível gerar chave única; tente novamente');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Emite lote demo/promo sem conta (trial horas/dias ou lifetime parceria).
   * ownerType PROMO + ownerId `promo:<batchId>` (sem migration, colunas String).
   * Retorna plaintext 1x por chave — o admin exibe uma vez e depois só máscara.
   */
  async issueTrial(
    dto: IssueTrialDto,
    actor: string,
    now = new Date(),
  ): Promise<{
    batchId: string;
    kind: string;
    expiresAt: string | null;
    items: Array<{ licenseId: string; key: string; keyMasked: string; expiresAt: string | null }>;
  }> {
    const qty = dto.qty ?? 1;
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
      throw new BadRequestException('qty deve ser inteiro entre 1 e 100.');
    }
    const maxDevices = dto.maxDevices ?? 1;
    if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 100) {
      throw new BadRequestException('maxDevices deve ser inteiro entre 1 e 100.');
    }
    const infinite = dto.infinite === true;
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : now;
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('startsAt inválido (ISO-8601).');
    const kind = infinite ? 'lifetime' : 'trial';
    const { expiresAt } =
      kind === 'lifetime' ? { expiresAt: null as Date | null } : calcExpiry(startsAt, 'trial', { expiresInHours: dto.expiresInHours });
    if (kind === 'trial' && !expiresAt) throw new BadRequestException('trial exige expiresInHours (1..8760).');
    // Sem graça extra p/ trial: graceUntil = expiresAt (expira seco).
    const graceUntil = kind === 'lifetime' ? null : expiresAt;
    const features = normalizeFeatureSnapshot(dto.features);
    const batchId = randomUUID().slice(0, 8);
    const ownerId = `promo:${batchId}`;
    const items: Array<{ licenseId: string; key: string; keyMasked: string; expiresAt: string | null }> = [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < qty; i++) {
        let inserted: LicenseRow | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const key = generateLicenseKey();
          try {
            const { rows } = await client.query(
              `INSERT INTO licenses (id, "ownerType", "ownerId", "ownerLabel", "productId", "planId", "contractItemId",
                kind, status, key_hash, key_prefix, key_last4, key_enc, "tokenVersion", "maxDevices",
                "issuedAt", "startsAt", "expiresAt", "graceUntil", features, "createdAt", "updatedAt")
               VALUES ($1,'PROMO',$2,$3,$4,$5,NULL,$6,'active',$7,$8,$9,$10,1,$11,now(),$12,$13,$14,$15,now(),now())
               RETURNING ${SELECT_COLS}`,
              [
                randomUUID(), ownerId, dto.ownerLabel ?? dto.note ?? null,
                dto.productId, dto.planId ?? null, kind,
                sha256Hex(key), key.slice(6, 10), key.slice(-4), encryptLicenseKey(key),
                maxDevices, startsAt, expiresAt, graceUntil,
                features.length > 0 ? JSON.stringify(features) : null,
              ],
            );
            inserted = rows[0] as LicenseRow;
            await this.insertOutbox(client, inserted.id, 'LicenseIssued', {
              licenseId: inserted.id,
              ownerType: 'PROMO',
              ownerId,
              ownerLabel: dto.ownerLabel ?? null,
              productId: dto.productId,
              planId: dto.planId ?? null,
              kind,
              batchId,
              trial: true,
              infinite,
              startsAt: startsAt.toISOString(),
              expiresAt: expiresAt ? expiresAt.toISOString() : null,
              graceUntil: graceUntil ? (graceUntil as Date).toISOString() : null,
              maxDevices,
              note: dto.note ?? null,
              actor,
            });
            items.push({
              licenseId: inserted.id,
              key,
              keyMasked: maskFromParts(inserted.key_last4),
              expiresAt: expiresAt ? (expiresAt as Date).toISOString() : null,
            });
            break;
          } catch (e) {
            if (isUniqueViolation(e)) continue;
            throw e;
          }
        }
        if (!inserted) throw new ConflictException('não foi possível gerar chave única; tente novamente');
      }
      await client.query('COMMIT');
      return { batchId, kind, expiresAt: expiresAt ? (expiresAt as Date).toISOString() : null, items };
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  private async loadRow(id: string): Promise<LicenseRow> {
    const { rows } = await this.pool.query(`SELECT ${SELECT_COLS} FROM licenses WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException(`license ${id} não encontrada`);
    return rows[0] as LicenseRow;
  }

  private async mutate(id: string, sql: string, type: (typeof LICENSE_OUTBOX_TYPES)[number], extra: Record<string, unknown>): Promise<MaskedLicense> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(sql, [id]);
      if (rows.length === 0) throw new NotFoundException(`license ${id} não encontrada`);
      const row = rows[0] as LicenseRow;
      await this.insertOutbox(client, row.id, type, { licenseId: row.id, ...extra });
      await client.query('COMMIT');
      return this.toMasked(row);
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* noop */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  private async insertOutbox(client: PoolClient, aggregateId: string, type: string, payload: Record<string, unknown>): Promise<string> {
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO outbox_events (id, "eventId", aggregate, "aggregateId", type, payload, "occurredAt", published, "createdAt")
       VALUES ($1,$2,'License',$3,$4,$5,now(),false,now())`,
      [randomUUID(), eventId, aggregateId, type, JSON.stringify(payload)],
    );
    return eventId;
  }
}
