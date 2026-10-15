import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_MY_LICENSES } from "@/lib/mocks";
import { resolveUpstream } from "@/lib/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const SESSION_COOKIE = "aurum_portal_session";

/** GET /api/me/licenses — licenças do titular (chaves sempre mascaradas). */
export async function GET(req: NextRequest) {
  const __up = resolveUpstream();
  if (__up.kind === "missing") return __up.response;
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Não autenticado." }, { status: 401 });
  }
  if (API_INTERNAL_URL && !session.startsWith("stub-")) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/licenses?mine=1`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
        { status: 502 }
      );
    }
  }
  // Stub dev-only (sem upstream, fora de prod). Corpo mantém o contrato
  // (array) do GET com backend; o cabeçalho x-aurum-stub marca a origem mock.
  return NextResponse.json(MOCK_MY_LICENSES, { headers: { "x-aurum-stub": "1" } });
}
