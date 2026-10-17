import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { ACCESS_POOL } from './access-pool.provider';
import {
  DatedCandidate,
  RowTransition,
  evaluateRow,
  summarizeTransitions,
} from './evaluator.transitions';

export type EvaluateSummary = {
  evaluatedAt: string;
  entitlementsToGrace: number;
  entitlementsToExpired: number;
  bonusToExpired: number;
  contractsToExpired: number;
  itemsToExpired: number;
};

// Avaliador determinístico de vigências (REQUIREMENTS.md §2: cron 5min).
// Regras idempotentes (UPDATE ... WHERE status=..., seguro em re-execução):
// - Entitlement ACTIVE com expires_at < now <= grace_until → GRACE.
// - Entitlement (ACTIVE|GRACE) com now > grace_until (ou sem graça e expirado) → EXPIRED.
// - BonusGrant/Contract/ContractItem ACTIVE com fim < now → EXPIRED.
// Vitalícios (expires/ends_at null) nunca são tocados.
//
// TODO(workers): agendamento via BullMQ repeat { every: 5min } em
// apps/workers/src/queues/licensing.evaluate (registerEvaluateRepeat) com
// jobId determinístico por janela; publicar transições no
// outbox (access.*.v1) para o relay. Este método é o handler puro do job e
// também é acionável manualmente via POST /v1/access/admin/evaluate.
@Injectable()
export class AccessEvaluatorService {
  private readonly log = new Logger(AccessEvaluatorService.name);

  constructor(
    @Inject(ACCESS_POOL) private readonly pool: Pool,
    // Pool opcional do domínio licensing (DATABASE_URL_LICENSING). Ausente →
    // evaluateLicenses() retorna skipped (sync espelha vigência via eventos).
    @Optional() private readonly licensingPool?: Pool,
  ) {}

  /** Versão pura do sweep (sem I/O): matriz de transição p/ teste e dry-run. */
  preview(rows: DatedCandidate[], now = new Date()): { transitions: RowTransition[]; summary: ReturnType<typeof summarizeTransitions> } {
    const transitions = rows.map((r) => evaluateRow(r, now));
    return { transitions, summary: summarizeTransitions(transitions) };
  }

  /**
   * Resume explícito: SUSPENDED → ACTIVE p/ uma origem (evento LicenseRenewed
   * ou ação admin). Idempotente; REVOKED/EXPIRED nunca regridem.
   */
  async resumeEntitlements(origin: string, originId: string): Promise<{ resumed: number }> {
    const r = await this.pool.query(
      `UPDATE entitlements SET status = 'ACTIVE', "updatedAt" = now()
       WHERE origin = $1 AND "originId" = $2 AND status = 'SUSPENDED'`,
      [origin, originId],
    );
    return { resumed: r.rowCount ?? 0 };
  }

  /**
 * Varredura do lado licensing. DOIS bugs que a deixavam sempre `skipped`
 * (nunca rodou em produção desde a Fase 3):
 * 1) a probe procurava `expires_at`/`grace_until` (SNAKE_CASE), mas as
 *    colunas reais são camelCase `"expiresAt"`/`"graceUntil"`
 *    (`prisma/licensing/schema.prisma:35-36`) → `cols=0`;
 * 2) o UPDATE comparava `status = 'ACTIVE'`, mas o valor persistido é
 *    minúsculo (`'active'`, gravado em `issueLicense`) → 0 linhas.
 *
 * A probe agora verifica as DUAS colunas por NOME (contar 2 não prova que
 * são as certas) e é explícita quanto ao schema (`licensing`, o mesmo
 * `search_path` do role `app_licensing`).
 *
 * DECISÃO: NÃO grava `status = 'expired'`. `status` é o lifecycle CRU —
 * o próprio schema documenta `pending_payment | active | suspended |
 * revoked (+ grace/expired derivados na leitura)`. Fabricar 'expired' ali
 * quebra os gates que testam o status CRU:
 * - `offline-token.service.ts:58` (`status !== 'active'`) → cairia em
 *   LICENSE_INACTIVE genérico ANTES do check de datas, trocando a mensagem
 *   correta `EXPIRED` ("licença expirada") por "licença com status expired";
 * - `devices.service.ts:267` e `:525` (`lic.status !== 'active'`) →
 *   `LICENSE_INACTIVE` no lugar do `EXPIRED` de `:534`.
 * Como `effectiveStatus` (license-keys.ts) já deriva expired/grace na
 * LEITURA de todo caminho de leitura, o sweep é um DETECTOR: conta o que
 * está vencido além da graça, sem fabricar estado — idempotente por natureza.
 * `FROM licenses` sem prefixo resolve `licensing.licenses` pelo search_path
 * do role (verificado: `search_path=licensing` em pg_db_role_setting) —
 * prefixo de schema seria redundante e acoparia o código a um schema fixo.
 */
  async evaluateLicenses(
    now = new Date(),
  ): Promise<{ evaluatedAt: string; skipped: boolean; toExpired: number; reason?: string }> {
    const iso = now.toISOString();
    if (!this.licensingPool) {
      return { evaluatedAt: iso, skipped: true, toExpired: 0, reason: 'sem licensingPool' };
    }
    let cols: string[] = [];
    try {
      const probe = await this.licensingPool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'licenses' AND column_name IN ('expiresAt', 'graceUntil')`,
        ['licensing'],
      );
      cols = (probe.rows as Array<{ column_name: string }>).map((r) => r.column_name);
    } catch {
      return { evaluatedAt: iso, skipped: true, toExpired: 0, reason: 'probe information_schema falhou' };
    }
    if (!cols.includes('expiresAt') || !cols.includes('graceUntil')) {
      return {
        evaluatedAt: iso,
        skipped: true,
        toExpired: 0,
        reason: 'licensing sem colunas de vigência camelCase (stub Fase 1)',
      };
    }
    try {
      const r = await this.licensingPool.query(
        `SELECT count(*)::int AS n FROM licenses
         WHERE status = 'active' AND "expiresAt" IS NOT NULL AND "expiresAt" < $1
           AND ("graceUntil" IS NULL OR "graceUntil" < $1)`,
        [iso],
      );
      return { evaluatedAt: iso, skipped: false, toExpired: Number((r.rows[0] as { n: number } | undefined)?.n ?? 0) };
    } catch {
      return { evaluatedAt: iso, skipped: true, toExpired: 0, reason: 'sweep licensing falhou (schema incompatível?)' };
    }
  }

  async evaluate(now = new Date()): Promise<EvaluateSummary> {
    const iso = now.toISOString();

    const toGrace = await this.pool.query(
      `UPDATE entitlements SET status = 'GRACE', "updatedAt" = now()
       WHERE status = 'ACTIVE' AND "expiresAt" IS NOT NULL AND "expiresAt" < $1
         AND "graceUntil" IS NOT NULL AND "graceUntil" >= $1`,
      [iso],
    );

    const toExpired = await this.pool.query(
      `UPDATE entitlements SET status = 'EXPIRED', "updatedAt" = now()
       WHERE status IN ('ACTIVE', 'GRACE')
         AND "expiresAt" IS NOT NULL AND "expiresAt" < $1
         AND ("graceUntil" IS NULL OR "graceUntil" < $1)`,
      [iso],
    );

    const bonusExpired = await this.pool.query(
      `UPDATE bonus_grants SET status = 'EXPIRED', "updatedAt" = now()
       WHERE status = 'ACTIVE' AND "endsAt" IS NOT NULL AND "endsAt" < $1`,
      [iso],
    );

    const contractsExpired = await this.pool.query(
      `UPDATE contracts SET status = 'EXPIRED', "updatedAt" = now()
       WHERE status = 'ACTIVE' AND "endsAt" IS NOT NULL AND "endsAt" < $1`,
      [iso],
    );

    const itemsExpired = await this.pool.query(
      `UPDATE contract_items SET status = 'EXPIRED', "updatedAt" = now()
       WHERE status IN ('ACTIVE', 'PENDING_PAYMENT')
         AND "endsAt" IS NOT NULL AND "endsAt" < $1`,
      [iso],
    );

    const summary: EvaluateSummary = {
      evaluatedAt: iso,
      entitlementsToGrace: toGrace.rowCount ?? 0,
      entitlementsToExpired: toExpired.rowCount ?? 0,
      bonusToExpired: bonusExpired.rowCount ?? 0,
      contractsToExpired: contractsExpired.rowCount ?? 0,
      itemsToExpired: itemsExpired.rowCount ?? 0,
    };
    this.log.log(`evaluate ${iso} ${JSON.stringify(summary)}`);
    return summary;
  }
}
