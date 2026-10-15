import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import { mockProductActiveClients, mockProductByCode } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `GET /api/products/:code/clients` — clientes com licenças ativas/em
 * graça do produto (agregado por `productId`).
 * Stub: `mockProductActiveClients` (licenças `lic-001`/`lic-002` → aurum-pro,
 * `lic-003` → aurum-base). 404 se o produto não existe.
 * TODO(backend pronto): remover stub — agregar no Nest as licenças por
 * `productId` (`GET /v1/licenses?productId=:code`, contando `active` vs
 * `grace`/`degraded` por titular); até lá o proxy abaixo repassa o status real.
 */
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (API_INTERNAL_URL) {
    // Real: lista mascarada do core (`GET /v1/licenses?productId=`, PG) com
    // `ownerLabel` p/ dispensar lookup cross-schema. BFF agrega por titular no
    // shape `ProductActiveClient` (ativas vs graça; demais estados ignorados).
    try {
      const upstream = await fetch(
        `${API_INTERNAL_URL}/v1/licenses?productId=${encodeURIComponent(params.code)}`,
        { headers: upstreamAuthHeaders(session) },
      );
      const data = (await upstream.json().catch(() => ({}))) as {
        items?: Array<{
          ownerId?: string;
          ownerLabel?: string | null;
          status?: string;
        }>;
      };
      if (!upstream.ok) {
        return NextResponse.json(data, { status: upstream.status });
      }
      const byOwner = new Map<string, { customerId: string; customerName: string; active: number; grace: number }>();
      for (const row of data.items ?? []) {
        const customerId = typeof row.ownerId === "string" ? row.ownerId : "?";
        const slot = byOwner.get(customerId) ?? {
          customerId,
          customerName:
            typeof row.ownerLabel === "string" && row.ownerLabel ? row.ownerLabel : customerId,
          active: 0,
          grace: 0,
        };
        if (row.status === "grace") slot.grace += 1;
        else if (row.status === "active") slot.active += 1;
        byOwner.set(customerId, slot);
      }
      return NextResponse.json(
        Array.from(byOwner.values()).filter((r) => r.active > 0 || r.grace > 0),
      );
    } catch {
      // DS §11 (anti-mock): falha real NUNCA cai em stub silencioso.
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
  }

  const product = mockProductByCode(params.code);
  if (!product) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Produto não encontrado." }, { status: 404 });
  }
  return NextResponse.json(mockProductActiveClients(params.code));
}
