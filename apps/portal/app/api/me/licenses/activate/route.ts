import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOCK_MY_LICENSES } from "@/lib/mocks";
import { resolveUpstream } from "@/lib/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const SESSION_COOKIE = "aurum_portal_session";

interface ActivateBody {
  productId?: string;
  app_instance_id?: string;
  label?: string;
}

/**
 * BFF `POST /api/me/licenses/activate` — modo A do instalador
 * ("entrar na conta", recomendado): resolve e-mail→licenças pela sessão,
 * vincula o dispositivo e emite o offline-token. Sem PII em log.
 */
export async function POST(req: NextRequest) {
  const __up = resolveUpstream();
  if (__up.kind === "missing") return __up.response;
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Entre na sua conta para ativar." },
      { status: 401 }
    );
  }
  const body = (await req.json().catch(() => ({}))) as ActivateBody;
  const appInstanceId = typeof body.app_instance_id === "string" ? body.app_instance_id : undefined;
  const label = typeof body.label === "string" ? body.label.slice(0, 120) : undefined;

  if (API_INTERNAL_URL && !session.startsWith("stub-")) {
    try {
      // 1. Minhas licenças (o Nest resolve `?mine=1` pelo identity do JWT).
      const listRes = await fetch(`${API_INTERNAL_URL}/v1/licenses?mine=1`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (listRes.status === 401) {
        return NextResponse.json(
          { code: "REVOKED", message: "Sessão expirada. Entre de novo." },
          { status: 401 }
        );
      }
      const list = (await listRes.json().catch(() => ({}))) as {
        items?: Array<{
          id: string;
          keyMasked?: string;
          productId?: string;
          planId?: string | null;
          status?: string;
          expiresAt?: string | null;
          graceUntil?: string | null;
        }>;
      };
      const items = Array.isArray(list.items) ? list.items : [];
      const usable = items.filter((l) => l.status === "active" || l.status === "grace");
      const picked =
        (body.productId ? usable.find((l) => l.productId === body.productId) : undefined) ??
        usable[0];
      if (!picked) {
        return NextResponse.json(
          { code: "ACCOUNT_NO_LICENSE", message: "Nenhuma licença ativa nesta conta." },
          { status: 404 }
        );
      }

      // 2. Vincula o dispositivo (o Nest deriva o HMAC de `app_instance_id`).
      const linkRes = await fetch(
        `${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(picked.id)}/devices/link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
          body: JSON.stringify({ app_instance_id: appInstanceId, label }),
        }
      );
      const link = (await linkRes.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
        device?: { device_hash?: string };
      };
      if (!linkRes.ok || !link.device?.device_hash) {
        return NextResponse.json(
          {
            code: typeof link.code === "string" ? link.code : "DEVICE_ERROR",
            message: typeof link.message === "string" ? link.message : "Falha ao vincular dispositivo.",
          },
          { status: linkRes.status }
        );
      }

      // 3. Emite o offline-token para o device vinculado.
      const tokenRes = await fetch(
        `${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(picked.id)}/offline-token?device_hash=${encodeURIComponent(link.device.device_hash)}`,
        { headers: { Authorization: `Bearer ${session}` } }
      );
      const token = (await tokenRes.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
        token?: string;
        off_exp?: string;
        token_version?: number;
      };
      if (!tokenRes.ok || !token.token) {
        return NextResponse.json(
          {
            code: typeof token.code === "string" ? token.code : "TOKEN_ERROR",
            message: typeof token.message === "string" ? token.message : "Falha ao emitir token offline.",
          },
          { status: tokenRes.status }
        );
      }

      return NextResponse.json({
        mode: "account",
        licenseId: picked.id,
        keyMasked: picked.keyMasked ?? null,
        productId: picked.productId ?? null,
        expiresAt: picked.expiresAt ?? null,
        graceUntil: picked.graceUntil ?? null,
        device_hash: link.device.device_hash,
        offlineToken: token.token,
        off_exp: token.off_exp ?? null,
        token_version: token.token_version ?? 1,
      });
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." },
        { status: 502 }
      );
    }
  }

  // Stub: ativa a primeira licença ativa local (sem token real).
  const usable = MOCK_MY_LICENSES.filter((l) => l.status === "active" || l.status === "grace");
  const picked =
    (body.productId ? usable.find((l) => l.productId === body.productId) : undefined) ?? usable[0];
  if (!picked) {
    return NextResponse.json(
      { code: "ACCOUNT_NO_LICENSE", message: "Nenhuma licença ativa nesta conta." },
      { status: 404 }
    );
  }
  return NextResponse.json({
    mode: "account",
    stub: true,
    licenseId: picked.id,
    keyMasked: picked.keyMasked,
    productId: picked.productId,
    expiresAt: picked.expiresAt,
    graceUntil: null,
    device_hash: `stub-device-${picked.id}`,
    offlineToken: `stub-offline-${picked.id}`,
    off_exp: null,
    token_version: 1,
  });
}
