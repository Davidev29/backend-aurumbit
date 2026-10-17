import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import { mockCustomerDetail, mockCustomerPage } from "@/lib/mocks";
import type { CustomerRow, CustomerStageFilter } from "@/lib/customers";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `GET /api/customers?q=&stage=&cursor=` → Nest `GET /v1/admin/customers`
 * (funil prospect → cliente, materializado de `auth.user_identities`).
 *
 * Sem `API_INTERNAL_URL`: `mockCustomerPage` (stub auditado de demonstração).
 * Com upstream: falha real NUNCA cai em mock (anti-mock, DS §11) — 502.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;

  const stage = normalizeStage(q.get("stage"));
  const cursor = q.get("cursor");
  const limitRaw = Number(q.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), 100) : 20;

  if (API_INTERNAL_URL) {
    try {
      const params = new URLSearchParams();
      const search = q.get("q")?.trim();
      if (search) params.set("q", search);
      if (stage) params.set("stage", stage);
      if (cursor) params.set("cursor", cursor);
      params.set("limit", String(limit));

      const upstream = await fetch(`${API_INTERNAL_URL}/v1/admin/customers?${params.toString()}`, {
        headers: upstreamAuthHeaders(session),
      });
      const data = (await upstream.json().catch(() => ({}))) as {
        data?: Array<{
          id: string;
          identityId: string;
          name: string;
          email: string;
          stage: string;
          emailVerified: boolean;
          registeredAt: string;
          stageChangedAt: string;
        }>;
        meta?: { nextCursor: string | null; limit: number };
        code?: string;
        message?: string;
      };
      if (!upstream.ok) {
        return NextResponse.json(
          { code: data.code ?? "UPSTREAM_ERROR", message: data.message ?? "Falha ao carregar clientes." },
          { status: upstream.status },
        );
      }
      const rows = Array.isArray(data.data) ? data.data : [];
      return NextResponse.json({
        data: rows.map(toCustomerRow),
        meta: data.meta ?? { nextCursor: null, limit },
      });
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
  }

  // Stub dev-only (sem backend). Mantém o formato de página p/ a tela não
  // conhecer a origem — e a UI sinaliza quando os dados são demonstração.
  const page = mockCustomerPage(q.get("q") ?? "", cursor);
  const rows = page.data.map((c) => {
    const detail = mockCustomerDetail(c.id);
    return {
      id: c.id,
      name: c.name,
      email: detail?.email ?? "",
      stage: c.status === "blocked" ? ("SUSPENDED" as const) : ("ACTIVE" as const),
      status: c.status,
      emailVerified: true,
      docMasked: detail?.docMasked ?? "",
      organizationId: detail?.organizationId ?? "",
      createdAt: detail?.createdAt ?? new Date().toISOString(),
      stageChangedAt: detail?.createdAt ?? new Date().toISOString(),
      products: [],
      licensesCount: c.licensesCount,
      stub: true,
    };
  });
  const filtered = stage ? rows.filter((r) => r.stage === stage) : rows;
  return NextResponse.json({
    data: filtered.slice(0, limit),
    meta: { nextCursor: null, limit },
  });
}

const STAGES = ["PROSPECT", "PENDING_PAYMENT", "ACTIVE", "SUSPENDED", "CANCELLED"] as const;

function normalizeStage(raw: string | null): (typeof STAGES)[number] | null {
  if (!raw) return null;
  return (STAGES as readonly string[]).includes(raw) ? (raw as (typeof STAGES)[number]) : null;
}

function toCustomerRow(row: {
  id: string;
  name: string;
  email: string;
  stage: string;
  emailVerified: boolean;
  registeredAt: string;
  stageChangedAt: string;
}): CustomerRow {
  const stage = (STAGES as readonly string[]).includes(row.stage)
    ? (row.stage as CustomerStageFilter)
    : "PROSPECT";
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    // Situação comercial (o filtro active/blocked é de ACESSO/licença; o
    // funil vive em `stage`) — `SUSPENDED` no funil também suspende o acesso.
    stage,
    status: stage === "SUSPENDED" || stage === "CANCELLED" ? "blocked" : "active",
    emailVerified: row.emailVerified === true,
    docMasked: "",
    organizationId: "",
    createdAt: row.registeredAt,
    stageChangedAt: row.stageChangedAt,
    products: [],
    licensesCount: 0,
  };
}