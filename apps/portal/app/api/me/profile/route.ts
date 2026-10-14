import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_MY_PROFILE } from "@/lib/mocks";
import { resolveUpstream } from "@/lib/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const SESSION_COOKIE = "aurum_portal_session";

/** GET /api/me/profile — perfil do titular. */
export async function GET(req: NextRequest) {
  const __up = resolveUpstream();
  if (__up.kind === "missing") return __up.response;
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Não autenticado." }, { status: 401 });
  }
  if (API_INTERNAL_URL && !session.startsWith("stub-")) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/customers/me`, {
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
  return NextResponse.json(MOCK_MY_PROFILE);
}

/** PATCH /api/me/profile — atualiza perfil (stub ecoa). */
export async function PATCH(req: NextRequest) {
  const __up = resolveUpstream();
  if (__up.kind === "missing") return __up.response;
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Não autenticado." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (API_INTERNAL_URL && !session.startsWith("stub-")) {
    try {
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/customers/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
        body: JSON.stringify(body),
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

  return NextResponse.json({
    ...MOCK_MY_PROFILE,
    ...body,
    address: { ...MOCK_MY_PROFILE.address, ...((body.address as Record<string, unknown>) ?? {}) },
    updatedAt: new Date().toISOString(),
  });
}
