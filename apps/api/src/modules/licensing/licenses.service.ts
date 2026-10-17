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
  GRACE_MS,
  LicenseKind,
  addMonthsUtc,
  calcExpiry,
  clockStatus,
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
  /** Lifecycle PERSISTIDO (pending_payment|active|suspended|revoked).
   *  grace/expired NUNCA são gravados: são derivados na leitura. */
  status: string;
  key_hash: string;
  key_prefix: string;
  key_last4: string;
  key_enc: string | null;
  tokenVersion: number;
  /** Limite de máquinas por licença (Fase 3 §4). Vem do schema há tempo
   *  mas faltava em `SELECT_COLS` — a UI recebia `undefined`. */
  maxDevices: number;
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

/**
 * Entrada de `GET /v1/licenses/:id/history`.
 *
 * Campos ORIGINAIS (contrato com o BFF admin, nunca removidos):
 * `licenseId`, `keyMasked`, `status`, `reason`, `endedAt`, `replacedBy`.
 *
 * Campos NOVOS (D2/D4): a UI precisa do vencimento COM HORA, da modalidade
 * e da origem da chave. `status` é o efetivo real (active|grace|expired|
 * suspended|revoked|replaced|pending_payment) — nunca mais derivado do tipo
 * do evento.
 */
export type LicenseHistoryEntry = {
  licenseId: string;
  keyMasked: string;
  status: string;
  reason: string | null;
  endedAt: string | null;
  replacedBy: string | null;
  /** ISO-8601 com hora (a UI formata; o backend nunca arredonda p/ dia). */
  startsAt: string | null;
  expiresAt: string | null;
  graceUntil: string | null;
  /** monthly | annual | lifetime | trial (modalidade comercial). */
  kind: string;
  productId: string;
  ownerType: string;
  ownerLabel: string | null;
  /** Status efetivo ATUAL da licença (derivado do relógio, não do evento). */
  currentStatus: string;
  /** Lifecycle CRU persistido (active|suspended|revoked|pending_payment). */
  rawStatus: string;
  /** true quando `status` veio do relógio (ex.: 'active' cru → 'expired'). */
  derivedFromClock: boolean;
  /** Tipo do evento do outbox que originou a linha. */
  eventType: string;
  occurredAt: string | null;
  /** true na última entrada (a linha do tempo mais recente). */
  current: boolean;
};

const SELECT_COLS = `id, "ownerType", "ownerId", "ownerLabel", "productId", "planId", "contractItemId",
  kind, status, key_hash, key_prefix, key_last4, key_enc, "tokenVersion", "maxDevices",
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
// `LicenseExtended`/`LicenseResumed` foram adicionados com a correção da
// derivação de status: sem eles, a reativação e a prorrogação eram
// invisíveis no histórico (bug reportado pelo usuário).
export const LICENSE_OUTBOX_TYPES = [
  'LicenseIssued',
  'LicenseRenewed',
  'LicenseExtended',
  'LicenseResumed',
  'LicenseRevoked',
  'LicenseSuspended',
] as const;

/** Eventos lidos por `licenseHistory` (fonte da trilha append-only). */
export const LICENSE_HISTORY_TYPES = [
  'LicenseIssued',
  'LicenseRenewed',
  'LicenseExtended',
  'LicenseResumed',
  'LicenseRevoked',
  'LicenseSuspended',
] as const;

/** Status EFETIVOS aceitos no filtro (persistidos + derivados). */
export const LICENSE_EFFECTIVE_STATUSES = [
  'pending_payment',
  'active',
  'grace',
  'suspended',
  'expired',
  'revoked',
] as const;

export type LicenseEffectiveStatus = (typeof LICENSE_EFFECTIVE_STATUSES)[number];

/**
 * Predicado SQL do status EFETIVO.
 *
 * `status` no banco é o lifecycle CRU (pending_payment|active|suspended|
 * revoked) — 'grace'/'expired' são DERIVADOS por `effectiveStatus`
 * (PROJECT.md §1). Decisão: o filtro vai AO SQL, porque filtrar em memória
 * DEPOIS do LIMIT é o que produz página mentirosa (20 linhas, 15 fora do
 * filtro). O predicado espelha as mesmas comparações de `effectiveStatus`
 * (`now <= expiresAt` → active; `now <= graceUntil` → grace) e é
 * SUPERCONJUNTO do filtro em JS em no máximo a diferença de precisão
 * (µs no PG vs ms no Date): por isso o chamador ainda reaplica
 * `effectiveStatus(...) === status` como portão final — o SQL nunca pode
 * devolver uma linha cujo `status` derivado seja diferente do pedido.
 *
 * `nowPlaceholder` é o placeholder JÁ ALOCADO para a data (`$2`, `$3`…):
 * o predicador é sempre montado DEPOIS das condições simples, então o
 * índice bate com a ordem de `params`. Passar `$1` à mão seria ligar a
 * coluna de data ao valor do titular — silenciosamente errado.
 */
export function statusSqlPredicate(status: string, nowPlaceholder: string): string {
  const n = nowPlaceholder;
  switch (status) {
    case 'pending_payment':
    case 'suspended':
    case 'revoked':
      // Persistidos: igualdade exata, sem ambiguidade. `status` é uma
      // coluna do ENUM fechado acima (chave de switch), nunca entrada do
      // usuário — interpolar a letra é seguro por construção.
      return `status = '${status}'`;
    case 'active':
      // Vigente = cru 'active' E ainda não venceu (boundary inclusiva,
      // igual `nowMs <= exp`). Vitalícia (expiresAt null) entra aqui.
      return `(status = 'active' AND ("expiresAt" IS NULL OR "expiresAt" >= ${n}))`;
    case 'grace':
      return `(status = 'active' AND "expiresAt" < ${n} AND "graceUntil" IS NOT NULL AND "graceUntil" >= ${n})`;
    case 'expired':
      return `(status = 'active' AND "expiresAt" < ${n} AND ("graceUntil" IS NULL OR "graceUntil" < ${n}))`;
    default:
      throw new BadRequestException(
        `status inválido: use ${LICENSE_EFFECTIVE_STATUSES.join('|')}.`,
      );
  }
}

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
    // Filtro de status vai AO SQL (não em memória depois do LIMIT): filtrar
    // pós-LIMIT devolve página mentirosa. O WHERE fica como pré-filtro e o
    // `effectiveStatus` abaixo segue como portão final (ver statusSqlPredicate).
    if (filters.status) {
      params.push(now.toISOString());
      conds.push(statusSqlPredicate(filters.status, `$${params.length}`));
    }
    const { rows } = await this.pool.query(
      `SELECT ${SELECT_COLS} FROM licenses WHERE ${conds.join(' AND ')} ORDER BY "createdAt" DESC LIMIT 200`,
      params,
    );
    let out = (rows as LicenseRow[]).map((r) => this.toMasked(r, now));
    if (filters.status) out = out.filter((l) => l.status === filters.status);
    return out;
  }

  /**
   * `GET /v1/products/:code/licenses` — estado ATUAL das licenças de um
   * produto, com paginação. O histórico (`licenseHistory`) conta a linha do
   * tempo; isto é o retrato de agora, derivado por `toMasked`.
   *
   * `productId` é a referência opaca cross-schema (o code do produto
   * gravado na emissão — mesma chave que `GET /v1/licenses?productId=`).
   */
  async listProductLicenses(
    productId: string,
    opts: { limit?: number; offset?: number; status?: string } = {},
    now = new Date(),
  ): Promise<{ items: MaskedLicense[]; total: number; limit: number; offset: number; hasMore: boolean }> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const where: string[] = [`"productId" = $1`];
    const params: unknown[] = [productId];
    if (opts.status) {
      params.push(now.toISOString());
      where.push(statusSqlPredicate(opts.status, `$${params.length}`));
    }
    const whereSql = where.join(' AND ');
    const count = await this.pool.query(
      `SELECT count(*)::int AS n FROM licenses WHERE ${whereSql}`,
      params,
    );
    const total = Number((count.rows[0] as { n: number } | undefined)?.n ?? 0);
    const page = await this.pool.query(
      `SELECT ${SELECT_COLS} FROM licenses WHERE ${whereSql}
       ORDER BY "createdAt" DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    let items = (page.rows as LicenseRow[]).map((r) => this.toMasked(r, now));
    // Portão final em JS: nenhum item sai com `status` diferente do pedido.
    if (opts.status) items = items.filter((l) => l.status === opts.status);
    return { items, total, limit, offset, hasMore: offset + items.length < total };
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
   * renovações, prorrogações, retomadas, suspensões e revogações com
   * motivo/sucessora. Antigas nunca são apagadas — a renovação-com-troca
   * preserva a anterior aqui. Espelha `LicenseHistoryEntry` do BFF admin.
   *
   * STATUS: NÃO vem do tipo do evento. Uma licença com `expiresAt` no
   * passado voltava 'active' para sempre (bug D1: chave vencida pintada de
   * verde). As entradas NÃO terminais (Issued/Renewed/Extended/Resumed)
   * carregam o status derivado do RELÓGIO (`clockStatus` sobre a linha),
   * e toda linha carrega as datas (`expiresAt`/`graceUntil`/`startsAt`)
   * para a UI exibir o vencimento COM HORA. O estado completo, com o
   * lifecycle persistido, vai em `currentStatus`/`rawStatus`.
   *
   * Por que não-terminal mostra o relógio e não o evento: o consumidor
   * (modal de produto do admin) renderiza a linha com `key={licenseId}` —
   * uma linha por licença, não por evento — e a pergunta do operador é
   * "qual o estado AGORA desta chave". O histórico cronológico de cada
   * evento fica em `eventType`/`occurredAt`. Eventos TERMINAIS
   * (revoked/suspended) preservam o próprio status — como manda
   * `effectiveStatus`, em que suspended/revoked vencem o relógio.
   */
  async licenseHistory(id: string, now = new Date()): Promise<LicenseHistoryEntry[]> {
    const row = await this.loadRow(id);
    const keyMasked = maskFromParts(row.key_last4);
    // Fonte única da verdade do estado atual (D4: o histórico também lê a
    // linha, não só os eventos).
    const current = effectiveStatus(row, now);
    // Status das linhas NÃO terminais: derivado só do relógio. Uma licença
    // revogada mostra a emissão como ela realmente estava (vigente/expirada)
    // e a revogação como 'revoked' — se as duas herdassem do status atual,
    // as duas linhas diriam "revoked" e a trilha não contaria nada.
    // `pending_payment` não é evento: preserva.
    const clock = row.status === 'pending_payment' ? 'pending_payment' : clockStatus(row, now);
    const iso = (v: Date | null): string | null =>
      v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null;
    const ctx = {
      licenseId: id,
      keyMasked,
      kind: row.kind,
      productId: row.productId,
      ownerType: row.ownerType,
      ownerLabel: row.ownerLabel,
      startsAt: iso(row.startsAt),
      expiresAt: iso(row.expiresAt),
      graceUntil: iso(row.graceUntil),
      currentStatus: current,
      rawStatus: row.status,
    };

    // `LICENSE_HISTORY_TYPES` é constante de código (literais seguros, sem
    // entrada do usuário) — interpolar evita a lista duplicada que já
    // drifted uma vez (LicenseExtended/LicenseResumed faltando).
    const typeList = LICENSE_HISTORY_TYPES.map((t) => `'${t}'`).join(',');
    const { rows } = await this.pool.query(
      `SELECT type, payload, "occurredAt" FROM outbox_events
       WHERE "aggregateId" = $1 AND type IN (${typeList})
       ORDER BY "occurredAt" ASC`,
      [id],
    );
    const events = rows as Array<{ type: string; payload: unknown; occurredAt: Date }>;

    // Sem evento algum (outbox podado/inexistente): sintetiza a partir da
    // linha para a UI nunca receber lista vazia de uma licença real.
    if (events.length === 0) {
      return [
        {
          ...ctx,
          status: current,
          derivedFromClock: row.status !== current,
          reason: null,
          endedAt: null,
          replacedBy: null,
          eventType: 'LicenseState',
          occurredAt: iso(row.updatedAt),
          current: true,
        },
      ];
    }

    const lastIndex = events.length - 1;
    return events.map((e, i) => {
      const meta = (e.payload ?? {}) as { reason?: unknown; replacedBy?: unknown };
      const reason = typeof meta.reason === 'string' ? meta.reason : null;
      const replacedBy = typeof meta.replacedBy === 'string' ? meta.replacedBy : null;
      const occurredAt = iso(e.occurredAt) ?? String(e.occurredAt ?? '');
      const isCurrent = i === lastIndex;
      const base = { ...ctx, occurredAt, current: isCurrent };
      switch (e.type) {
        case 'LicenseRevoked':
          // Encerrada por troca (renovação que substituiu a chave) é
          // 'replaced' — o front já rotula "Substituída"; revogação sem
          // sucessora segue 'revoked' ("Revogada").
          return {
            ...base,
            status: replacedBy ? 'replaced' : 'revoked',
            derivedFromClock: false,
            reason,
            endedAt: occurredAt,
            replacedBy,
            eventType: e.type,
          };
        case 'LicenseSuspended':
          return {
            ...base,
            status: 'suspended',
            derivedFromClock: false,
            reason,
            endedAt: occurredAt,
            replacedBy: null,
            eventType: e.type,
          };
        default:
          // Issued/Renewed/Extended/Resumed: o que o RELÓGIO diz desta
          // licença. Uma chave vencida aparece 'expired' aqui — o bug.
          return {
            ...base,
            status: clock,
            derivedFromClock: row.status !== clock,
            reason,
            endedAt: null,
            replacedBy,
            eventType: e.type,
          };
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

  /**
   * Retoma suspensa. AGORA EMITE OUTBOX (`LicenseResumed`): sem isso a
   * reativação era invisível no histórico — parte do bug reportado
   * ("chaves vencidas/defasadas" sem rastro). O outbox + o UPDATE na
   * mesma transação (`mutate`) mantêm a trilha consistente com o estado.
   */
  async resumeLicense(id: string, reason: string, actor?: string): Promise<MaskedLicense> {
    const prev = await this.loadRow(id);
    if (prev.status !== 'suspended') throw new ConflictException('só licença suspensa pode ser retomada');
    return this.mutate(
      id,
      `UPDATE licenses SET status = 'active', "updatedAt" = now() WHERE id = $1 RETURNING ${SELECT_COLS}`,
      'LicenseResumed',
      { reason, actor: actor ?? 'unknown', previousStatus: prev.status },
    );
  }

  /**
   * Prorroga IN-PLACE: estende `expiresAt`/`graceUntil` na MESMA licença,
   * preservando `id`, `key_hash` e os vínculos de máquina que o cliente já
   * tem. Diferente de `renewLicense`, que cria licença nova (nova chave) e
   * obriga o cliente a trocar a chave.
   *
   * Regras:
   * - `revoked` → 409 (terminal; prorrogar chave revogada falsifica a trilha).
   * - `pending_payment` → 409 (não paga; igual ao renew).
   * - `suspended` → permitido: a suspensão é estado de ADMIN, independente
   *   das datas. Prorrogar não retoma a licença.
   * - expirada / em graça / ativa → permitido (é exatamente o caso de uso:
   *   resgate de chave vencida sem trocar a chave do cliente).
   * - `lifetime` (sem `expiresAt`) → 409 LIFETIME_NO_EXTEND: não existe
   *   vencimento a prorrogar; o caminho análogo é emitir vitalícia nova.
   *
   * Base do cálculo = `max(now, expiresAt)` — como o renew, não abre buraco:
   * prorrogar dentro da graça continua do vencimento anterior, e prorrogar
   * JÁ vencida conta de agora (o período perdido não é inventado).
   *
   * `tokenVersion`: NÃO é incrementado (decisão documentada abaixo).
   * Prorrogar SOMA direito, nunca tira — invalidar offline-tokens aqui
   * puniria justamente o cliente-desktop que se trouve expirado e que
   * acabou de ser resgatado, forçando revalidação online imediata. O
   * `off_exp` dos tokens já emitidos fica no `min(iat+7d, expiresAt+7d)`
   * ANTIGO, ou seja sempre ≤ nova vigência — estender não abre
   * sobre-permissão. O bump continua reservado à revogação (perda de
   * direito), que é onde ele é necessário.
   *
   * UPDATE + outbox na MESMA transação: prorrogação sem trilha é
   * exatamente o tipo de buraco que esta correção veio fechar.
   */
  async extendLicense(
    id: string,
    months: number,
    reason: string,
    actor: string,
    now = new Date(),
  ): Promise<{ license: MaskedLicense; previousExpiresAt: string }> {
    const prev = await this.loadRow(id);
    if (prev.status === 'revoked') {
      throw new ConflictException({ code: 'REVOKED_NO_EXTEND', message: 'licença revogada não pode ser prorrogada' });
    }
    if (prev.status === 'pending_payment') {
      throw new ConflictException({ code: 'PENDING_NO_EXTEND', message: 'licença pendente de pagamento não pode ser prorrogada' });
    }
    // Vitalícia/sem expiresAt: nada a prorrogar. Cobre `lifetime` e linhas
    // legadas sem data (não inventamos vigência).
    if (!prev.expiresAt) {
      throw new ConflictException({ code: 'LIFETIME_NO_EXTEND', message: 'licença sem expiração (vitalícia) não pode ser prorrogada' });
    }
    if (!Number.isInteger(months) || months < 1 || months > 12) {
      throw new BadRequestException('months deve ser inteiro entre 1 e 12.');
    }
    const previousExpiresAt = prev.expiresAt.toISOString();
    const base = new Date(Math.max(now.getTime(), prev.expiresAt.getTime()));
    const expiresAt = addMonthsUtc(base, months);
    // Trial/promo não herda graça (mesma regra de `calcExpiry`).
    const graceUntil = prev.kind === 'trial' ? expiresAt : new Date(expiresAt.getTime() + GRACE_MS);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE licenses SET "expiresAt" = $2, "graceUntil" = $3, "updatedAt" = now()
         WHERE id = $1 RETURNING ${SELECT_COLS}`,
        [id, expiresAt.toISOString(), graceUntil.toISOString()],
      );
      if (rows.length === 0) throw new NotFoundException(`license ${id} não encontrada`);
      const row = rows[0] as LicenseRow;
      await this.insertOutbox(client, id, 'LicenseExtended', {
        licenseId: id,
        productId: row.productId,
        ownerId: row.ownerId,
        kind: row.kind,
        months,
        reason,
        actor,
        previousExpiresAt,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        graceUntil: row.graceUntil?.toISOString() ?? null,
        statusBefore: prev.status,
        statusAfter: effectiveStatus(row, now),
        // tokenVersion inalterado de propósito (ver doc da linha acima).
        tokenVersion: row.tokenVersion,
      });
      await client.query('COMMIT');
      return { license: this.toMasked(row, now), previousExpiresAt };
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
