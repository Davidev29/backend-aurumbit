/**
 * Projeções — orquestração (Fase 5).
 *
 * GET: lê ProjectionSnapshot(scope, refDate, premisesHash); hit → 200;
 * miss → estima o volume: abaixo do teto computa inline (200), acima
 * enfileira `finance.projection.compute` e retorna 202 + jobId p/ polling
 * em `GET jobs/:jobId`. O teto default (FINANCE_PROJECTION_INLINE_MAX_INPUTS
 * ou 5000) aproxima a regra "cômputo >500ms → 202"; o tempo real de cada
 * cômputo é observado em `finance.projection.*` (computeAvgMs/MaxMs).
 *
 * POST recompute (finance.manage): invalida snapshots do período + enfileira.
 * FinanceTransactionPosted (interno): invalida snapshots cujo período contém
 * o occurredAt — a próxima leitura recomputa sob demanda.
 */

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PREMISES,
  Premises,
  ProjectionScope,
  SUPPORTED_TZ,
  assertValidPremises,
  assertValidRef,
  assertValidScope,
  assertValidTz,
  computeProjection,
  hashPremises,
  periodFor,
  type ProjectionSnapshot,
} from './projections.compute';
import { ProjectionMetrics } from './projections.metrics';
import {
  PROJECTION_QUEUE,
  ProjectionQueuePort,
  projectionJobId,
  projectionJobOptions,
} from './projections.queue';
import { PROJECTION_SOURCE, ProjectionSource } from './projections.source';
import {
  PROJECTION_STORE,
  ProjectionJobRegistry,
  ProjectionSnapshotStore,
  StoredSnapshot,
} from './projections.store';

export interface ProjectionQuery {
  scope: string;
  ref?: string;
  tz?: string;
}

export type GetProjectionResult =
  | { httpStatus: 200; body: { cached: boolean; snapshot: StoredSnapshot } }
  | {
      httpStatus: 202;
      body: { queued: true; jobId: string; scope: string; refDate: string; tz: string; premisesHash: string };
    };

function todaySp(): string {
  // Parede America/Sao_Paulo (UTC−3 fixo): desloca o instante e lê em UTC.
  const sp = new Date(Date.now() + -3 * 3_600_000);
  const mm = String(sp.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(sp.getUTCDate()).padStart(2, '0');
  return `${sp.getUTCFullYear()}-${mm}-${dd}`;
}

@Injectable()
export class ProjectionsService {
  private readonly logger = new Logger(ProjectionsService.name);

  /** Teto de insumos p/ cômputo inline (mutável em testes). */
  public inlineMaxInputs = Number(process.env.FINANCE_PROJECTION_INLINE_MAX_INPUTS ?? 5000);

  constructor(
    @Inject(PROJECTION_SOURCE) private readonly source: ProjectionSource,
    @Inject(PROJECTION_STORE) private readonly store: ProjectionSnapshotStore,
    @Inject(PROJECTION_QUEUE) private readonly queue: ProjectionQueuePort,
    private readonly jobs: ProjectionJobRegistry,
    private readonly metrics: ProjectionMetrics,
  ) {}

  private parseQuery(q: ProjectionQuery): { scope: ProjectionScope; refDate: string; tz: typeof SUPPORTED_TZ } {
    try {
      assertValidScope(q.scope);
    } catch {
      throw new BadRequestException({ code: 'INVALID_SCOPE', message: 'scope use monthly|quarterly|annual.' });
    }
    const refDate = q.ref ?? todaySp();
    try {
      assertValidRef(refDate);
    } catch {
      throw new BadRequestException({ code: 'INVALID_REF', message: 'ref use YYYY-MM-DD (data existente).' });
    }
    const tz = q.tz ?? SUPPORTED_TZ;
    try {
      assertValidTz(tz);
    } catch {
      throw new BadRequestException({ code: 'UNSUPPORTED_TZ', message: `tz suportada no v1: ${SUPPORTED_TZ}.` });
    }
    return { scope: q.scope as ProjectionScope, refDate, tz };
  }

  async getProjection(q: ProjectionQuery, opts: { forceQueue?: boolean } = {}): Promise<GetProjectionResult> {
    const { scope, refDate, tz } = this.parseQuery(q);
    const premises = DEFAULT_PREMISES;
    const premisesHash = hashPremises(premises);
    this.metrics.inc('finance.projection.requested');

    const hit = await this.store.find(scope, refDate, premisesHash);
    if (hit) {
      this.metrics.inc('finance.projection.hit');
      return { httpStatus: 200, body: { cached: true, snapshot: hit } };
    }
    this.metrics.inc('finance.projection.miss');

    const { start, end } = periodFor(scope, refDate, tz);
    let load = 0;
    try {
      load = await this.source.estimateLoad({ start, end });
    } catch {
      load = this.inlineMaxInputs + 1; // fonte instável → via fila (retry no worker)
    }
    if (!opts.forceQueue && load <= this.inlineMaxInputs) {
      const snapshot = await this.computeAndStore(scope, refDate, tz, premises);
      return { httpStatus: 200, body: { cached: false, snapshot } };
    }
    const jobId = projectionJobId(scope, refDate, premisesHash);
    try {
      await this.queue.add(
        'compute',
        { jobId, scope, refDate, tz, premisesHash },
        projectionJobOptions(jobId),
      );
    } catch (err) {
      this.metrics.inc('finance.projection.failed');
      this.logger.warn(
        JSON.stringify({ event: 'finance.projection.enqueue_failed', jobId, err: String(err) }),
      );
      throw new BadRequestException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'Fila indisponível; tente novamente (o próximo GET recomputa inline).',
      });
    }
    this.jobs.markPending({ jobId, scope, refDate, tz, premisesHash });
    this.metrics.inc('finance.projection.queued');
    return { httpStatus: 202, body: { queued: true, jobId, scope, refDate, tz, premisesHash } };
  }

  /**
   * Computa + upsert (idempotente). Usado pelo caminho inline e pelo
   * endpoint interno do worker. Marca o job como done quando existir.
   */
  async computeAndStore(
    scope: string,
    refDate: string,
    tz: string,
    premises: Premises = DEFAULT_PREMISES,
  ): Promise<StoredSnapshot> {
    assertValidScope(scope);
    assertValidRef(refDate);
    assertValidTz(tz);
    assertValidPremises(premises);
    const { start, end } = periodFor(scope, refDate, tz);
    const t0 = Date.now();
    const inputs = await this.source.listInputs({ start, end });
    const snapshot: ProjectionSnapshot = computeProjection({
      scope,
      refDate,
      tz,
      premises,
      inputs,
      computedAt: new Date().toISOString(),
    });
    const stored = await this.store.upsert(snapshot);
    const ms = Date.now() - t0;
    this.metrics.observeCompute(ms);
    this.metrics.inc('finance.projection.computed');
    this.jobs.markDone(projectionJobId(scope, refDate, snapshot.premisesHash));
    if (ms > 500) {
      this.logger.warn(
        JSON.stringify({
          event: 'finance.projection.slow_inline',
          scope,
          refDate,
          ms,
          inputs: snapshot.inputCounts,
        }),
      );
    }
    return stored;
  }

  async recompute(body: { scope?: string; ref?: string; tz?: string }): Promise<{
    invalidated: number;
    jobs: Array<{ jobId: string; scope: string; refDate: string }>;
  }> {
    const tz = body.tz ?? SUPPORTED_TZ;
    try {
      assertValidTz(tz);
    } catch {
      throw new BadRequestException({ code: 'UNSUPPORTED_TZ', message: `tz suportada no v1: ${SUPPORTED_TZ}.` });
    }
    const premisesHash = hashPremises(DEFAULT_PREMISES);
    const targets: Array<{ scope: ProjectionScope; refDate: string }> = [];
    if (body.scope && body.ref) {
      try {
        assertValidScope(body.scope);
        assertValidRef(body.ref);
      } catch {
        throw new BadRequestException({ code: 'INVALID_RECOMPUTE', message: 'scope/ref inválidos.' });
      }
      targets.push({ scope: body.scope as ProjectionScope, refDate: body.ref });
    } else {
      // Sem alvo: invalida tudo e enfileira o mês/trimestre/ano correntes.
      const today = todaySp();
      targets.push(
        { scope: 'monthly', refDate: today },
        { scope: 'quarterly', refDate: today },
        { scope: 'annual', refDate: today },
      );
    }
    let invalidated = 0;
    if (body.scope && body.ref) {
      const { start, end } = periodFor(targets[0].scope, targets[0].refDate, tz);
      invalidated = await this.store.invalidateRange(start.toISOString(), end.toISOString());
    } else {
      invalidated = await this.store.invalidateRange('1970-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z');
    }
    this.metrics.inc('finance.projection.invalidated', invalidated);
    const jobs: Array<{ jobId: string; scope: string; refDate: string }> = [];
    for (const t of targets) {
      const jobId = projectionJobId(t.scope, t.refDate, premisesHash);
      await this.queue.add(
        'compute',
        { jobId, scope: t.scope, refDate: t.refDate, tz, premisesHash },
        projectionJobOptions(jobId),
      );
      this.jobs.markPending({ jobId, scope: t.scope, refDate: t.refDate, tz, premisesHash });
      this.metrics.inc('finance.projection.queued');
      jobs.push({ jobId, scope: t.scope, refDate: t.refDate });
    }
    return { invalidated, jobs };
  }

  /** Invalidação no evento FinanceTransactionPosted do período. */
  async handleTransactionPosted(occurredAtIso: string): Promise<{ invalidated: number }> {
    const at = new Date(occurredAtIso);
    if (Number.isNaN(at.getTime())) {
      throw new BadRequestException({ code: 'INVALID_OCCURRED_AT', message: 'occurredAt ISO inválida.' });
    }
    const iso = at.toISOString();
    const invalidated = await this.store.invalidateRange(iso, iso);
    this.metrics.inc('finance.projection.invalidated', invalidated);
    return { invalidated };
  }

  getJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: `job ${jobId} desconhecido.` });
    return job;
  }
}
