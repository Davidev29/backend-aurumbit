/**
 * Projeções — snapshot store + registro de jobs (Fase 5).
 *
 * Chave do snapshot: (scope, refDate, premisesHash). `upsert` é
 * idempotente (recomputo concorrente / retry do worker não duplica).
 * Invalidação: remove snapshots cujo período sobrepõe o intervalo
 * (usada pelo recompute e pelo evento FinanceTransactionPosted).
 *
 * Persistência: `createSnapshotStore()` usa Postgres
 * (DATABASE_URL_FINANCE) quando configurado, senão in-memory.
 * A tabela `projection_snapshots` é criada com IF NOT EXISTS pelo
 * adaptador — decisão p/ não conflitar com o workstream dono do
 * finance core / schema Prisma: TODO(core) absorver no
 * `prisma/finance/schema.prisma` como model ProjectionSnapshot.
 *
 * O DDL do adaptador espelha o do schema Prisma de propósito: PK `id`
 * + UNIQUE (scope, ref_date, premises_hash). NÃO recrie UNIQUE(scope):
 * o core guarda UM snapshot por PERÍODO (mesmo scope, refDates
 * diferentes) e o índice global de `scope` — que vivia até a migration
 * 20261017000000 — fazia o 2º período do mesmo scope estourar PG 23505
 * → HTTP 500 no GET. O marcador do sync (namespace `global | org:<id>`)
 * arbitra pela PK `id` (id determinístico), logo segue íntegro.
 *
 * Jobs (polling do 202): registro em memória por instância; em
 * produção multi-instância o estado canônico é o job BullMQ
 * (`jobId = scope:ref:hash`) — TODO(Fase 6) ler o job no Redis.
 */

import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ProjectionSnapshot } from './projections.compute';

export interface StoredSnapshot extends ProjectionSnapshot {
  storedAt: string;
}

export type ProjectionJobStatus = 'pending' | 'done' | 'failed';

export interface ProjectionJob {
  jobId: string;
  scope: string;
  refDate: string;
  tz: string;
  premisesHash: string;
  status: ProjectionJobStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectionSnapshotStore {
  find(scope: string, refDate: string, premisesHash: string): Promise<StoredSnapshot | null>;
  upsert(snap: ProjectionSnapshot): Promise<StoredSnapshot>;
  /** Remove snapshots com sobreposição ao intervalo; retorna removidos. */
  invalidateRange(startIso: string, endIso: string): Promise<number>;
}

export const PROJECTION_STORE = 'FINANCE_PROJECTION_STORE';

function keyOf(scope: string, refDate: string, premisesHash: string): string {
  return `${scope}:${refDate}:${premisesHash}`;
}

/**
 * `id` determinístico da linha (mesmos 3 inputs → mesmo id), para o
 * INSERT continuar idempotente em retry/recompute concorrente.
 *
 * O banco migrado pelo Prisma (`prisma/finance/schema.prisma` +
 * `0001_baseline`) tem `id TEXT NOT NULL` como PK com `@default(cuid())`
 * — default *client-side*, sem DEFAULT no Postgres — então o INSERT
 * precisa fornecer o valor, senão viola NOT NULL (HTTP 500).
 */
export function snapshotIdOf(scope: string, refDate: string, premisesHash: string): string {
  return createHash('sha256').update(keyOf(scope, refDate, premisesHash)).digest('hex');
}

function overlaps(snapStart: string, snapEnd: string, startIso: string, endIso: string): boolean {
  return snapStart < endIso && snapEnd > startIso;
}

@Injectable()
export class InMemoryProjectionStore implements ProjectionSnapshotStore {
  private readonly snaps = new Map<string, StoredSnapshot>();

  async find(scope: string, refDate: string, premisesHash: string): Promise<StoredSnapshot | null> {
    return this.snaps.get(keyOf(scope, refDate, premisesHash)) ?? null;
  }

  async upsert(snap: ProjectionSnapshot): Promise<StoredSnapshot> {
    const stored: StoredSnapshot = { ...snap, storedAt: new Date().toISOString() };
    this.snaps.set(keyOf(snap.scope, snap.refDate, snap.premisesHash), stored);
    return stored;
  }

  async invalidateRange(startIso: string, endIso: string): Promise<number> {
    let removed = 0;
    for (const [k, s] of this.snaps) {
      if (overlaps(s.period.start, s.period.end, startIso, endIso)) {
        this.snaps.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.snaps.size;
  }
}

/**
 * Adaptador Postgres (lazy `pg`, sem conexão ansiosa — seguro no
 * boot/build sem banco, mesmo padrão dos pools de billing).
 */
export class PgProjectionSnapshotStore implements ProjectionSnapshotStore {
  private pool: import('pg').Pool | null = null;
  private ensured = false;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  private connect(): import('pg').Pool {
    if (!this.pool) {
      const { Pool } = require('pg') as typeof import('pg');
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL_FINANCE,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      });
    }
    return this.pool;
  }

  private async ensure(): Promise<void> {
    if (this.ensured) return;
    await this.connect().query(
      `CREATE TABLE IF NOT EXISTS projection_snapshots (
        id TEXT NOT NULL,
        scope TEXT NOT NULL,
        ref_date TEXT NOT NULL,
        premises_hash TEXT NOT NULL,
        tz TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (id)
      );
       CREATE UNIQUE INDEX IF NOT EXISTS projection_snapshots_scope_ref_date_premises_hash_key
         ON projection_snapshots (scope, ref_date, premises_hash);
       CREATE INDEX IF NOT EXISTS projection_snapshots_period_idx
         ON projection_snapshots (period_start, period_end);`,
    );
    this.ensured = true;
  }

  async find(scope: string, refDate: string, premisesHash: string): Promise<StoredSnapshot | null> {
    await this.ensure();
    const { rows } = await this.connect().query(
      `SELECT payload, updated_at AS "storedAt" FROM projection_snapshots
        WHERE scope = $1 AND ref_date = $2 AND premises_hash = $3`,
      [scope, refDate, premisesHash],
    );
    if (rows.length === 0) return null;
    const payload = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
    return { ...(payload as ProjectionSnapshot), storedAt: new Date(rows[0].storedAt).toISOString() };
  }

  async upsert(snap: ProjectionSnapshot): Promise<StoredSnapshot> {
    await this.ensure();
    await this.connect().query(
      `INSERT INTO projection_snapshots (id, scope, ref_date, premises_hash, tz, period_start, period_end, payload, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
        ON CONFLICT (scope, ref_date, premises_hash) DO UPDATE SET
          payload = EXCLUDED.payload, updated_at = now()`,
      [
        snapshotIdOf(snap.scope, snap.refDate, snap.premisesHash),
        snap.scope,
        snap.refDate,
        snap.premisesHash,
        snap.tz,
        snap.period.start,
        snap.period.end,
        JSON.stringify(snap),
      ],
    );
    const stored: StoredSnapshot = { ...snap, storedAt: new Date().toISOString() };
    return stored;
  }

  async invalidateRange(startIso: string, endIso: string): Promise<number> {
    await this.ensure();
    const { rowCount } = await this.connect().query(
      `DELETE FROM projection_snapshots WHERE period_start < $2 AND period_end > $1`,
      [startIso, endIso],
    );
    return rowCount ?? 0;
  }
}

export function createSnapshotStore(): ProjectionSnapshotStore {
  if (process.env.DATABASE_URL_FINANCE) return new PgProjectionSnapshotStore();
  return new InMemoryProjectionStore();
}

/** Registro de jobs p/ polling do 202 (em memória; ver nota no topo). */
@Injectable()
export class ProjectionJobRegistry {
  private readonly jobs = new Map<string, ProjectionJob>();

  markPending(job: Omit<ProjectionJob, 'status' | 'createdAt' | 'updatedAt'>): ProjectionJob {
    const now = new Date().toISOString();
    const existing = this.jobs.get(job.jobId);
    const entry: ProjectionJob = {
      ...job,
      status: 'pending',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    delete (entry as { error?: string }).error;
    this.jobs.set(job.jobId, entry);
    return entry;
  }

  markDone(jobId: string): void {
    const j = this.jobs.get(jobId);
    if (j) {
      j.status = 'done';
      j.updatedAt = new Date().toISOString();
    }
  }

  markFailed(jobId: string, error: string): void {
    const j = this.jobs.get(jobId);
    if (j) {
      j.status = 'failed';
      j.error = error.slice(0, 500);
      j.updatedAt = new Date().toISOString();
    }
  }

  get(jobId: string): ProjectionJob | null {
    return this.jobs.get(jobId) ?? null;
  }
}
