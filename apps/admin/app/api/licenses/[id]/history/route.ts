import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import type { LicenseHistoryEntry } from "@/lib/types";
import { mockLicenseHistory } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/** Lotes simultâneos no fan-out de histórico (não martela o upstream). */
const FANOUT_CONCURRENCY = 6;

/**
 * BFF `GET /api/licenses/:id/history?scope=&limit=`
 *
 * `:id` aceita licenseId OU productCode. `scope` declara qual é:
 * - `product` (o que a aba do produto manda): vai DIRETO ao fan-out das
 *   licenças do produto. Antes o BFF sondava `/v1/licenses/:productCode/history`
 *   primeiro e dependia do **404 do upstream** para descobrir que `id` era um
 *   product code — ida-e-volta inútil em toda abertura da aba e log de erro
 *   falso no core. Declarar o escopo elimina a sonda.
 * - ausente (legado): mantém o comportamento antigo (sonda + fallback), para
 *   não quebrar chamadores que não conhecem o parâmetro.
 *
 * O fan-out deixou de ser SEQUENCIAL (`for` com `await`): era O(N) round-trips
 * em série. Agora é `Promise.all` com janela de `FANOUT_CONCURRENCY`.
 *
 * `limit` recorta a página no BFF depois de ordenar por `occurredAt` desc —
 * a trilha pode ser grande e o modal só mostra o topo.
 *
 * Anti-mock (DS §11): com `API_INTERNAL_URL`, erro de rede é 502
 * `UPSTREAM_UNAVAILABLE`, nunca stub silencioso.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const scope = req.nextUrl.searchParams.get("scope");
  const rawLimit = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.trunc(rawLimit) : null;

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

  /**
   * Preenche SÓ O QUE A ENTRADA NÃO TRAZ.
   *
   * Antes o contexto da LISTA sobrescrevia a entrada (`...e, ...ctx`) — e isso
   * é errado desde que a Lane B do backend passou a mandar `startsAt`/
   * `expiresAt`/`graceUntil`/`kind` POR ENTRADA. Uma licença prorrogada em
   * março tem, na lista, o `expiresAt` novo; a entrada de janeiro é um evento
   * passado e precisa do `expiresAt` antigo. Sobrescrever apagava a história
   * justamente no campo que o operador usa para auditar.
   */
  const withCtx = (entries: LicenseHistoryEntry[], ctx: LicenseCtx): LicenseHistoryEntry[] =>
    entries.map((e) => ({
      kind: null,
      expiresAt: null,
      ownerType: null,
      ownerLabel: null,
      ...e,
      ...(e.kind ? {} : ctx.kind ? { kind: ctx.kind } : {}),
      ...(e.expiresAt ? {} : ctx.expiresAt ? { expiresAt: ctx.expiresAt } : {}),
      ...(e.ownerType ? {} : ctx.ownerType ? { ownerType: ctx.ownerType } : {}),
      ...(e.ownerLabel ? {} : ctx.ownerLabel ? { ownerLabel: ctx.ownerLabel } : {}),
    }));

  /** Mais recente primeiro; entrada sem data vai p/ o fim (não é a "atual"). */
  const newestFirst = (entries: LicenseHistoryEntry[]): LicenseHistoryEntry[] =>
    [...entries].sort((a, b) => {
      const at = Date.parse(String(a.occurredAt ?? a.endedAt ?? ""));
      const bt = Date.parse(String(b.occurredAt ?? b.endedAt ?? ""));
      return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
    });

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

    /** productCode → licenças → históricos concatenados (janela de N). */
    const aggregateByProduct = async (productCode: string) => {
      const byProduct = await fetch(
        `${API_INTERNAL_URL}/v1/licenses?productId=${encodeURIComponent(productCode)}`,
        { headers },
      );
      const list = (await byProduct.json().catch(() => ({}))) as
        | {
            items?: Array<{
              id?: string;
              kind?: unknown;
              expiresAt?: unknown;
              ownerType?: unknown;
              ownerLabel?: unknown;
            }>;
          }
        | Array<{
            id?: string;
            kind?: unknown;
            expiresAt?: unknown;
            ownerType?: unknown;
            ownerLabel?: unknown;
          }>;
      if (!byProduct.ok) {
        return { passthrough: NextResponse.json(list, { status: byProduct.status }) };
      }
      const items = Array.isArray(list) ? list : (list.items ?? []);
      const ctxById = new Map<string, LicenseCtx>();
      for (const item of items) {
        if (typeof item.id === "string") ctxById.set(item.id, ctxOf(item));
      }
      const ids = items
        .map((item) => item.id)
        .filter((id): id is string => typeof id === "string");
      const out: LicenseHistoryEntry[] = [];
      // Fan-out com janela: `for` sequencial era O(N) round-trips em série; o
      // pool mantém o upstream em rotação sem despejar tudo de uma vez.
      for (let i = 0; i < ids.length; i += FANOUT_CONCURRENCY) {
        const batch = ids.slice(i, i + FANOUT_CONCURRENCY);
        const results = await Promise.all(batch.map((id) => historyOf(id)));
        for (let b = 0; b < batch.length; b += 1) {
          if (results[b].found) out.push(...withCtx(results[b].entries, ctxById.get(batch[b]) ?? {}));
        }
      }
      return { passthrough: null, out };
    };

    try {
      if (scope === "product") {
        const { passthrough, out } = await aggregateByProduct(params.id);
        if (passthrough) return passthrough;
        const sorted = newestFirst(out);
        return NextResponse.json(limit ? sorted.slice(0, limit) : sorted);
      }
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
      // 2) Fallback legado (sem `scope`): productCode → fan-out.
      const { passthrough, out } = await aggregateByProduct(params.id);
      if (passthrough) return passthrough;
      const sorted = newestFirst(out);
      return NextResponse.json(limit ? sorted.slice(0, limit) : sorted);
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

  const stub = mockLicenseHistory(params.id);
  const sorted = newestFirst(Array.isArray(stub) ? stub : []);
  return NextResponse.json(limit ? sorted.slice(0, limit) : sorted);
}
