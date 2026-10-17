import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockLicenseById } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/licenses/:id/suspend` → Nest `POST /v1/licenses/:id/suspend`.
 *
 * Suspensão é estado de ADMIN (≠ revogação): a chave continua sendo do
 * cliente e pode voltar com `/resume`. O upstream emite outbox
 * `LicenseSuspended` na mesma transação — sem isso a ação sumia do histórico.
 *
 * 409 do upstream (revoked | já suspensa | pending_payment | expired) é a
 * última linha e é repassado com o corpo original.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  const raw = (await req.json().catch(() => ({}))) as { reason?: unknown; motivo?: unknown };
  const reason = typeof raw.reason === "string" ? raw.reason : typeof raw.motivo === "string" ? raw.motivo : "";

  if (API_INTERNAL_URL) {
    // `LicenseReasonDto`: {reason >= 10} — whitelist estrita.
    if (reason.trim().length < 10) {
      return NextResponse.json(
        { code: "UNPROCESSABLE", message: "Motivo deve ter ao menos 10 caracteres." },
        { status: 422 },
      );
    }
    let upstream: Response;
    try {
      upstream = await fetch(`${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(params.id)}/suspend`, {
        method: "POST",
        headers: { ...upstreamAuthJsonHeaders(session), ...forwardIdempotency(req) },
        body: JSON.stringify({ reason: reason.trim() }),
      });
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  // Stub (sem `API_INTERNAL_URL`): espelha as regras do Nest (409 nos estados
  // onde suspender não faz sentido) — mutação SINTÉTICA em memória.
  const license = mockLicenseById(params.id);
  if (!license) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Licença não encontrada." }, { status: 404 });
  }
  if (reason.trim().length < 10) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Motivo deve ter ao menos 10 caracteres." },
      { status: 422 },
    );
  }
  if (license.status === "revoked") {
    return NextResponse.json(
      { code: "CONFLICT", message: "Licença revogada não pode ser suspensa." },
      { status: 409 },
    );
  }
  if (license.status === "expired") {
    return NextResponse.json(
      { code: "CONFLICT", message: "Licença expirada não pode ser suspensa — renove ou prorrogue." },
      { status: 409 },
    );
  }
  license.status = "suspended";
  return NextResponse.json({ ...license, stub: true });
}

function forwardIdempotency(req: NextRequest): Record<string, string> {
  const v = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
  return v ? { "Idempotency-Key": v } : {};
}
