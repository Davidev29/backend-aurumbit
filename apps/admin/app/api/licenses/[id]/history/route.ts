import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import type { LicenseHistoryEntry } from "@/lib/types";
import { mockLicenseHistory } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `GET /api/licenses/:id/history` — histórico de substituições.
 * `:id` aceita licenseId OU productCode: com productCode, agrega o histórico
 * de todas as licenças do produto (a aba do produto chama com o code).
 * Cada entrada é enriquecida com o contexto da licença (`kind`/`expiresAt`/
 * `ownerType`/`ownerLabel`) p/ a UI exibir modalidade, expiração e origem
 * sem nova rodada de fetches.
 * Stub: `mockLicenseHistory` (aceita licenseId; customerId retorna o agregado).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  /** Contexto da licença p/ modalidade/expiração/origem na UI. */
  type LicenseCtx = {
    kind?: string | null;
    expiresAt?: string | null;
    ownerType?: string | null;
    ownerLabel?: string | null;
  };
  const ctxOf = (l: {
    kind?: unknown;
    expiresAt?: unknown;
    ownerType?: unknown;
    ownerLabel?: unknown;
  }): LicenseCtx => ({
    kind: typeof l.kind === "string" ? l.kind : null,
    expiresAt: typeof l.expiresAt === "string" ? l.expiresAt : null,
    ownerType: typeof l.ownerType === "string" ? l.ownerType : null,
    ownerLabel: typeof l.ownerLabel === "string" ? l.ownerLabel : null,
  });
  const withCtx = (entries: LicenseHistoryEntry[], ctx: LicenseCtx): LicenseHistoryEntry[] =>
    entries.map((e) => ({
      kind: null,
      expiresAt: null,
      ownerType: null,
      ownerLabel: null,
      ...e,
      ...Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== null)),
    }));

  if (API_INTERNAL_URL) {
    const headers = upstreamAuthHeaders(session);
    const historyOf = async (
      licenseId: string,
    ): Promise<{ found: boolean; entries: LicenseHistoryEntry[] }> => {
      try {
        const upstream = await fetch(
          `${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(licenseId)}/history`,
          { headers },
        );
        if (upstream.status === 404) return { found: false, entries: [] };
        if (!upstream.ok) {
          const data = await upstream.json().catch(() => ({}));
          throw { status: upstream.status, data };
        }
        const data = (await upstream.json().catch(() => null)) as LicenseHistoryEntry[] | null;
        return { found: true, entries: Array.isArray(data) ? data : [] };
      } catch (err: unknown) {
        if (err && typeof err === "object" && "status" in err) throw err;
        throw { status: 502, data: { code: "UPSTREAM_UNAVAILABLE" } };
      }
    };
    try {
      // 1) Tenta como licenseId direto (+ contexto da própria licença).
      const direct = await historyOf(params.id);
      if (direct.found) {
        const detail = await fetch(`${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(params.id)}`, {
          headers,
        })
          .then((r) => (r.ok ? r.json().catch(() => ({})) : {}))
          .catch(() => ({}));
        return NextResponse.json(withCtx(direct.entries, ctxOf(detail as Record<string, unknown>)));
      }
      // 2) Fallback: productCode → licenças do produto → históricos concatenados.
      const byProduct = await fetch(
        `${API_INTERNAL_URL}/v1/licenses?productId=${encodeURIComponent(params.id)}`,
        { headers },
      );
      const list = (await byProduct.json().catch(() => ({}))) as {
        items?: Array<{
          id?: string;
          kind?: unknown;
          expiresAt?: unknown;
          ownerType?: unknown;
          ownerLabel?: unknown;
        }>;
      } | Array<{
        id?: string;
        kind?: unknown;
        expiresAt?: unknown;
        ownerType?: unknown;
        ownerLabel?: unknown;
      }>;
      if (!byProduct.ok) {
        return NextResponse.json(list, { status: byProduct.status });
      }
      const items = Array.isArray(list) ? list : (list.items ?? []);
      const ctxById = new Map<string, LicenseCtx>();
      for (const item of items) {
        if (typeof item.id === "string") ctxById.set(item.id, ctxOf(item));
      }
      const out: LicenseHistoryEntry[] = [];
      for (const item of items) {
        if (typeof item.id !== "string") continue;
        const h = await historyOf(item.id);
        if (h.found) out.push(...withCtx(h.entries, ctxById.get(item.id) ?? {}));
      }
      return NextResponse.json(out);
    } catch (err: unknown) {
      // DS §11 (anti-mock): falha real NUNCA cai em stub silencioso.
      const status =
        err && typeof err === "object" && "status" in err && typeof err.status === "number"
          ? err.status
          : 502;
      const data =
        err && typeof err === "object" && "data" in err
          ? (err.data as unknown)
          : { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." };
      return NextResponse.json(data, { status });
    }
  }

  return NextResponse.json(mockLicenseHistory(params.id));
}
