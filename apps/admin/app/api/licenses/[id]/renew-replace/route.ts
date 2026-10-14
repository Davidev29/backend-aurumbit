import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockRenewReplace } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/licenses/:id/renew-replace` → Nest `POST /v1/licenses/:id/renew`
 * (renova criando NOVA licença, sem lacuna em graça) + `POST
 * /v1/licenses/:id/revoke` (desativa a anterior com motivo). Responde
 * `{ newLicenseId, revoked: true, auditId }`; histórico preservado no backend.
 * Valida motivo ≥ 10 + confirmação explícita → 422 senão.
 * Falha real → 502 UPSTREAM_UNAVAILABLE, nunca stub silencioso (DS §11).
 * TODO(backend pronto): remover stub — orquestração abaixo assume o Nest real.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();
  const body = (await req.json().catch(() => ({}))) as { motivo?: unknown; confirmacao?: unknown };

  if (typeof body.motivo !== "string" || body.motivo.trim().length < 10) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Motivo deve ter ao menos 10 caracteres." },
      { status: 422 },
    );
  }
  if (body.confirmacao !== true) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Renovação com substituição exige confirmação explícita." },
      { status: 422 },
    );
  }

  if (API_INTERNAL_URL) {
    // Orquestração real do modelo "nova licença desativa a anterior" sobre o
    // core PG: 1) `POST /v1/licenses/:id/renew` (cria NOVA licença com
    // continuidade `starts_at = max(now, expires_at)`, herda kind) → 2) revoke
    // da anterior com motivo + `replacedBy` (histórico preservado no outbox).
    // Falha parcial expõe os ids p/ reconciliação (DS §11).
    const headers = {
      ...upstreamAuthJsonHeaders(session),
      "Idempotency-Key": key,
    };
    const fail = (code: string, message: string, status: number, extra?: Record<string, unknown>) =>
      NextResponse.json({ code, message, ...extra }, { status });
    try {
      const renewed = await fetch(
        `${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(params.id)}/renew`,
        { method: "POST", headers, body: JSON.stringify({}) },
      );
      const renewedData = (await renewed.json().catch(() => ({}))) as {
        license?: { id?: string };
        code?: string;
        message?: string;
      };
      if (!renewed.ok || !renewedData.license?.id) {
        return NextResponse.json(renewedData, { status: renewed.status });
      }
      const newLicenseId = renewedData.license.id;
      const revoked = await fetch(
        `${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(params.id)}/revoke`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ reason: body.motivo, replacedBy: newLicenseId }),
        },
      );
      if (!revoked.ok) {
        const revokedData = await revoked.json().catch(() => ({}));
        return fail(
          "UPSTREAM_UNAVAILABLE",
          "Nova licença emitida, mas a anterior não foi desativada. Reconcile manualmente.",
          502,
          { newLicenseId, revoked: false, upstream: revokedData },
        );
      }
      const auditId = newKey();
      const res = NextResponse.json({ newLicenseId, revoked: true, auditId });
      res.headers.set("X-Aurum-Audit", auditId);
      return res;
    } catch {
      return fail("UPSTREAM_UNAVAILABLE", "Backend indisponível. Tente novamente.", 502);
    }
  }

  return NextResponse.json(mockRenewReplace(params.id, { motivo: body.motivo, confirmacao: true }));
}

/**
 * BFF `GET /api/licenses/:id/renew-replace` não existe — histórico em
 * `GET /api/licenses/:id/history` (stub `mockLicenseHistory`; real: trilha
 * do Nest — TODO expor endpoint dedicado).
 */

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
