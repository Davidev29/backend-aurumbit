import { apiGet } from "./api/client";
import type { Page } from "./types";

/**
 * Funil de clientes (admin) via BFF `/api/customers` → Nest
 * `GET /v1/admin/customers`.
 *
 * Estágios (`CustomerStatus` do domínio customers, espelhado no
 * `prisma/customers/schema.prisma`):
 * - `PROSPECT`        conta cadastrada, e-mail ainda não confirmado;
 * - `PENDING_PAYMENT` cliente com compra iniciada, aguardando pagamento;
 * - `ACTIVE`          cliente (conta ativada, com ou sem compra);
 * - `SUSPENDED`       bloqueado pelo admin;
 * - `CANCELLED`       cancelado.
 */
export type CustomerStageFilter =
  | "PROSPECT"
  | "PENDING_PAYMENT"
  | "ACTIVE"
  | "SUSPENDED"
  | "CANCELLED";

/** Rótulo e tom do badge por estágio (texto + cor — nunca só cor). */
export const CUSTOMER_STAGE_META: Record<
  CustomerStageFilter,
  { label: string; tone: "info" | "warn" | "ok" | "danger" | "neutral"; description: string }
> = {
  PROSPECT: {
    label: "Prospect",
    tone: "info",
    description: "Cadastrou-se, mas ainda não confirmou o e-mail.",
  },
  PENDING_PAYMENT: {
    label: "Aguardando pagamento",
    tone: "warn",
    description: "Cliente com compra iniciada e pagamento pendente.",
  },
  ACTIVE: {
    label: "Cliente",
    tone: "ok",
    description: "Conta ativada — cliente mesmo sem ter comprado.",
  },
  SUSPENDED: {
    label: "Suspenso",
    tone: "danger",
    description: "Acesso bloqueado pelo administrador.",
  },
  CANCELLED: {
    label: "Cancelado",
    tone: "neutral",
    description: "Relacionamento encerrado.",
  },
};

/**
 * Linha do funil como chega do BFF. Espelha `CustomerRow` da tela
 * (`components/clientes/customer-data`), por isso `status`/`createdAt`/
 * `docMasked`/`organizationId` existem: o funil alimenta a MESMA tabela e o
 * modal de detalhe, que já consome esses campos.
 */
export interface CustomerRow {
  id: string;
  name: string;
  email: string;
  /** Funil comercial (persistido). */
  stage: CustomerStageFilter;
  /** Eixo de acesso (licença ativa/bloqueada) — distinto do funil. */
  status: "active" | "blocked";
  /** `auth.email_verified_at` preenchido (conta ativada). */
  emailVerified: boolean;
  /** Documento mascarado (LGPD) — vazio enquanto o titular não informar. */
  docMasked: string;
  /** Organização PJ do titular, quando houver (FK em customers). */
  organizationId: string;
  /** Quando o cadastro foi enviado (identidade). */
  createdAt: string;
  /** Última mudança de estágio da projeção. */
  stageChangedAt: string;
  /** Produtos (derivado de licenças/assinaturas; vazio enquanto não houver). */
  products: string[];
  licensesCount: number;
  /** `true` quando os dados vieram do stub de demonstração. */
  stub?: boolean;
}

export interface CustomerListParams {
  q?: string;
  stage?: CustomerStageFilter | null;
  cursor?: string | null;
  limit?: number;
}

export interface CustomerSummaryCounts {
  PROSPECT: number;
  PENDING_PAYMENT: number;
  ACTIVE: number;
  SUSPENDED: number;
  CANCELLED: number;
}

const EMPTY_COUNTS: CustomerSummaryCounts = {
  PROSPECT: 0,
  PENDING_PAYMENT: 0,
  ACTIVE: 0,
  SUSPENDED: 0,
  CANCELLED: 0,
};

export function toQuery(params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** Página do funil (cursor por `CustomerProfile.id`). */
export function listCustomerStages(
  params: CustomerListParams = {},
): Promise<Page<CustomerRow>> {
  return apiGet<Page<CustomerRow>>(
    `/api/customers${toQuery({
      q: params.q ?? null,
      stage: params.stage ?? null,
      cursor: params.cursor ?? null,
      limit: params.limit ? String(params.limit) : null,
    })}`,
  );
}

/** Contagem por estágio (cards do topo). Falha → contagem zerada, nunca erro. */
export async function fetchStageCounts(): Promise<CustomerSummaryCounts> {
  try {
    const counts = await apiGet<CustomerSummaryCounts>("/api/customers/summary");
    return { ...EMPTY_COUNTS, ...counts };
  } catch {
    return EMPTY_COUNTS;
  }
}

/** "Prospect há 3 dias" — usado na tabela e no detalhe. */
export function stageAgeLabel(stageChangedAt: string): string {
  const ms = Date.now() - new Date(stageChangedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return minutes <= 1 ? "agora" : `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? "ontem" : `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months <= 1 ? "há 1 mês" : `há ${months} meses`;
}