import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_ME_ADMIN } from "@/lib/mocks";
import type { MeResponse } from "@/lib/types";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";

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
    // Identidade real do Nest (`GET /v1/auth/me`); permissões seguem o mock
    // admin até o RBAC real (TODO A4) — mas id/e-mail/MFA passam a ser reais.
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/auth/me`, {
      headers: upstreamAuthJsonHeaders(session),
    });
    const data = (await upstream.json().catch(() => ({}))) as {
      identityId?: string;
      email?: string;
      emailVerified?: boolean;
      mfaEnabled?: boolean;
    };
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    const me: MeResponse = {
      ...MOCK_ME_ADMIN,
      id: typeof data.identityId === "string" && data.identityId ? data.identityId : MOCK_ME_ADMIN.id,
      email: typeof data.email === "string" && data.email ? data.email : MOCK_ME_ADMIN.email,
      mfaRequired: false,
      mfaVerified: data.mfaEnabled === true,
    };
    return NextResponse.json(me);
  }

  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Não autenticado." }, { status: 401 });
  }
  // Stub: espelha o usuário da sessão criada em `login` (manager ↔ sem `finance.read`).
  const { MOCK_ME_MANAGER } = await import("@/lib/mocks");
  if (session.includes("u-manager-1")) return NextResponse.json(MOCK_ME_MANAGER);
  return NextResponse.json(MOCK_ME_ADMIN);
}
