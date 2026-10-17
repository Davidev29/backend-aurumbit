import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { CUSTOMERS_POOL } from './customers-pool.provider';

/**
 * Funil comercial de clientes — fonte da tela "Clientes" do admin.
 *
 * ## O que este serviço resolve
 *
 * O cadastro do portal cria uma **identidade** em `auth.user_identities`
 * (`PENDING_VERIFICATION`); a ativação (verify-email) vira `ACTIVE`. O admin,
 * porém, precisa enxergar o titular mesmo **sem nenhuma compra** — status
 * esse que não existe em `licensing`/`billing`, onde só aparece quem já
 * comprou. É o `CustomerProfile` do domínio customers que representa esse
 * papel, e o enum `CustomerStatus` já tem `PROSPECT` como default do schema
 * (`prisma/customers/schema.prisma:83`) — mas nada o criava: o `patchMe`
 * legado só nascia perfil quando o próprio titular editava o perfil, em store
 * em memória.
 *
 * ## Regra de transição (o que o usuário pediu)
 *
 * - cadastro aceito (submit do formulário)   → PROSPECT  (aparece no admin)
 * - e-mail confirmado (conta ativada)        → ACTIVE    (vira cliente)
 *
 * A promoção acontece por **upsert idempotente** a partir da identidade: o
 * `auth` é a fonte da verdade do estágio, e o `customer_profiles` é a
 * projeção materializada. Assim o funil não depende de nenhum evento/worker
 * (que hoje é stub — ver `apps/workers/src/main.ts`) e nunca "esquece" um
 * cadastro já feito. Regressão é bloqueada: `ACTIVE` nunca volta a `PROSPECT`
 * por efeito do sync.
 *
 * ## Por que ler `auth` daqui
 *
 * `DATABASE_URL_CUSTOMERS` e `DATABASE_URL_AUTH` apontam para o **mesmo**
 * banco `aurumbit` (schemas separados, ver `deploy/init-consolidated.sql`), e a
 * FK `customer_profiles.identity_id → auth.user_identities(id)` já existe
 * (migração `0002_fase9_identity_fk`). O domínio customers, porém, ainda é
 * `CustomersService` em memória (Fase 2) — este serviço é a fatia **real e
 * persistida** do mesmo domínio, sem tocar no service legado.
 *
 * ## LGPD
 *
 * A listagem devolve e-mail **em claro** porque é a tela operacional do staff
 * (necessário para contato) — o acesso exige `StaffGuard` (role `STAFF_*` ou
 * allowlist `ADMIN_STAFF_EMAILS`, fail-closed). Não há PII em log.
 */

/** Estágio do funil, derivado do `CustomerStatus` persistido. */
export type CustomerStage = 'PROSPECT' | 'PENDING_PAYMENT' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

/** Linha da listagem de clientes para o admin. */
export interface AdminCustomerRow {
  /** `CustomerProfile.id` (projeção) — mesmo id usado nos detalhes. */
  id: string;
  /** `auth.user_identities.id` (opaco; FK real). */
  identityId: string;
  /** Nome exibido: vem do perfil; vazio cai para a parte local do e-mail. */
  name: string;
  email: string;
  stage: CustomerStage;
  /** `auth.email_verified_at` preenchido (conta ativada). */
  emailVerified: boolean;
  /** `auth.user_identities.createdAt` — quando o cadastro foi enviado. */
  registeredAt: string;
  /** `CustomerProfile.updatedAt` — quando o estágio mudou pela última vez. */
  stageChangedAt: string;
}

export interface AdminCustomerPage {
  data: AdminCustomerRow[];
  meta: { nextCursor: string | null; limit: number };
}

export interface ListAdminCustomersParams {
  /** Busca por nome/e-mail (ILIKE). */
  q?: string | null;
  stage?: CustomerStage | null;
  /** Cursor opaco = `CustomerProfile.id` do último item da página. */
  cursor?: string | null;
  limit?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Upsert da projeção PF a partir da identidade. Idempotente e monotônico:
 * - PROSPECT nasce de identidade ainda não verificada;
 * - vira ACTIVE quando `email_verified_at` aparece;
 * - `PENDING_PAYMENT`/`SUSPENDED`/`CANCELLED` (decisão comercial/financeira)
 *   NUNCA são rebaixados por este sync — o admin comanda esses estágios.
 */
const SYNC_SQL = `
INSERT INTO customers.customer_profiles (id, kind, identity_id, status, name, email, created_at, updated_at)
SELECT
  gen_random_uuid()::text,
  'PF',
  u.id,
  CASE WHEN u.email_verified_at IS NOT NULL OR u.status = 'ACTIVE'
       THEN 'ACTIVE'::customers."CustomerStatus"
       ELSE 'PROSPECT'::customers."CustomerStatus" END,
  '',
  u.email_display,
  u."createdAt",
  now()
FROM auth.user_identities u
WHERE u.status <> 'DELETED'
ON CONFLICT (identity_id) DO UPDATE SET
  email = EXCLUDED.email,
  status = CASE
    WHEN customers.customer_profiles.status = 'PROSPECT'::customers."CustomerStatus"
         AND EXCLUDED.status = 'ACTIVE'::customers."CustomerStatus"
      THEN 'ACTIVE'::customers."CustomerStatus"
    ELSE customers.customer_profiles.status
  END,
  updated_at = CASE
    WHEN customers.customer_profiles.status <> EXCLUDED.status THEN now()
    ELSE customers.customer_profiles.updated_at
  END
`;

/** Lista paginada por cursor (id), do mais novo pro mais antigo. */
const LIST_SQL = `
SELECT
  p.id,
  p.identity_id AS "identityId",
  p.name,
  p.email,
  p.status::text AS stage,
  (u.email_verified_at IS NOT NULL) AS "emailVerified",
  COALESCE(u."createdAt", p.created_at) AS "registeredAt",
  p.updated_at AS "stageChangedAt"
FROM customers.customer_profiles p
JOIN auth.user_identities u ON u.id = p.identity_id
WHERE p.kind = 'PF'
  AND ($1::text IS NULL OR p.status::text = $1)
  AND ($2::text IS NULL OR p.email ILIKE '%' || $2 || '%' OR p.name ILIKE '%' || $2 || '%')
  AND ($3::text IS NULL OR p.created_at < (SELECT c.created_at FROM customers.customer_profiles c WHERE c.id = $3))
ORDER BY p.created_at DESC, p.id DESC
LIMIT $4
`;

@Injectable()
export class CustomerPipelineService {
  constructor(@Inject(CUSTOMERS_POOL) private readonly pool: Pool) {}

  /**
   * Materializa a projeção PF a partir das identidades (idempotente). Chamado
   * no boot do admin e antes de cada listagem: barato (1 upsert) e garante
   * que um cadastro feito há 1 segundo já apareça como prospect.
   */
  async syncIdentities(): Promise<number> {
    const res = await this.pool.query(SYNC_SQL);
    return res.rowCount ?? 0;
  }

  /** Listagem do funil (admin). Roda o sync antes de ler. */
  async list(params: ListAdminCustomersParams = {}): Promise<AdminCustomerPage> {
    await this.syncIdentities();

    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const q = params.q?.trim() ? params.q.trim() : null;
    const stage = params.stage ?? null;
    const cursor = params.cursor ?? null;

    const res = await this.pool.query(LIST_SQL, [stage, q, cursor, limit + 1]);
    const rows = res.rows as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map(toRow);
    return {
      data,
      meta: { nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null, limit },
    };
  }

  /** Contagem por estágio (cards do topo do admin). */
  async countByStage(): Promise<Record<CustomerStage, number>> {
    const res = await this.pool.query<{ stage: CustomerStage; n: string }>(
      `SELECT status::text AS stage, count(*)::text AS n
       FROM customers.customer_profiles
       WHERE kind = 'PF'
       GROUP BY status`,
    );
    const out = { PROSPECT: 0, PENDING_PAYMENT: 0, ACTIVE: 0, SUSPENDED: 0, CANCELLED: 0 };
    for (const row of res.rows) {
      if (row.stage in out) out[row.stage] = Number(row.n);
    }
    return out;
  }
}

function toRow(row: Record<string, unknown>): AdminCustomerRow {
  const email = typeof row.email === 'string' ? row.email : '';
  const name = typeof row.name === 'string' && row.name.trim() !== '' ? row.name : email.split('@')[0] ?? '';
  return {
    id: String(row.id),
    identityId: String(row.identityId),
    name,
    email,
    stage: String(row.stage) as CustomerStage,
    emailVerified: row.emailVerified === true,
    registeredAt: new Date(String(row.registeredAt)).toISOString(),
    stageChangedAt: new Date(String(row.stageChangedAt)).toISOString(),
  };
}