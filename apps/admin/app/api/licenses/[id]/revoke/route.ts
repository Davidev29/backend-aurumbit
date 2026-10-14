import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockLicenseById } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/licenses/:id/revoke` → Nest `POST /v1/licenses/:id/revoke`.
 * Revogação: bump `token_version`, invalida JWTs/offline-tokens no próximo
 * online (PROJECT §2). Exige `license.adjust` + confirmação explícita.
 * TODO(backend pronto): remover stub — proxy integral abaixo assume.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (API_INTERNAL_URL) {
    // Core `LicenseReasonDto`: {reason≥10, replacedBy?} (whitelist estrita,
    // sem `actor` — o ator vem de `x-actor-id`/x-role no Nest).
    const raw = (await req.json().catch(() => ({}))) as { motivo?: unknown; reason?: unknown };
    const reason =
      typeof raw.reason === "string" ? raw.reason : typeof raw.motivo === "string" ? raw.motivo : "";
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(params.id)}/revoke`, {
      method: "POST",
      headers: {
        ...upstreamAuthJsonHeaders(session),
        ...forwardIdempotency(req),
      },
      body: JSON.stringify({ reason }),
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  const license = mockLicenseById(params.id);
  if (!license) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Licença não encontrada." }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { motivo?: unknown; confirmacao?: unknown };
  if (typeof body.motivo !== "string" || body.motivo.trim().length < 10) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Motivo deve ter ao menos 10 caracteres." },
      { status: 422 },
    );
  }
  if (body.confirmacao !== true) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Revogação exige confirmação explícita." },
      { status: 422 },
    );
  }
  return NextResponse.json({ revoked: true });
}

function forwardIdempotency(req: NextRequest): Record<string, string> {
  const v = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
  return v ? { "Idempotency-Key": v } : {};
}
