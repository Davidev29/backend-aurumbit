import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_ME_ADMIN } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/** Frontend-first (dev): `ADMIN_DEV_OPEN=1` responde admin mock sem sessão. */
function isDevOpen(): boolean {
  return process.env.ADMIN_DEV_OPEN === "1";
}

/**
 * BFF `GET /api/auth/me` — identidade + permissões efetivas (menu por
 * permissões do backend). TODO(backend pronto): proxy real p/ Nest.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value;

  if (isDevOpen()) return NextResponse.json(MOCK_ME_ADMIN);

  if (API_INTERNAL_URL) {
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/auth/me`, {
      headers: { ...(session ? { Cookie: `aurum_session=${session}` } : {}) },
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Não autenticado." }, { status: 401 });
  }
  // Stub: espelha o usuário da sessão criada em `login` (manager ↔ sem `finance.read`).
  const { MOCK_ME_MANAGER } = await import("@/lib/mocks");
  if (session.includes("u-manager-1")) return NextResponse.json(MOCK_ME_MANAGER);
  return NextResponse.json(MOCK_ME_ADMIN);
}
