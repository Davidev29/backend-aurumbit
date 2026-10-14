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
 * Stub: `mockLicenseHistory` (aceita licenseId; customerId retorna o agregado).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

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
      // 1) Tenta como licenseId direto.
      const direct = await historyOf(params.id);
      if (direct.found) return NextResponse.json(direct.entries);
      // 2) Fallback: productCode → licenças do produto → históricos concatenados.
      const byProduct = await fetch(
        `${API_INTERNAL_URL}/v1/licenses?productId=${encodeURIComponent(params.id)}`,
        { headers },
      );
      const list = (await byProduct.json().catch(() => ({}))) as {
        items?: Array<{ id?: string }>;
      };
      if (!byProduct.ok) {
        return NextResponse.json(list, { status: byProduct.status });
      }
      const out: LicenseHistoryEntry[] = [];
      for (const item of list.items ?? []) {
        if (typeof item.id !== "string") continue;
        const h = await historyOf(item.id);
        if (h.found) out.push(...h.entries);
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
