import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockLicenseById } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/licenses/:id/adjust` → Nest `POST /v1/licenses/:id/adjust`.
 * Exige `license.adjust`; justificativa >= 10 (REQUIREMENTS §2/§5).
 * TODO(backend pronto): remover stub — proxy integral abaixo assume.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (API_INTERNAL_URL) {
    const body = await req.text();
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(params.id)}/adjust`, {
      method: "POST",
      headers: {
        ...upstreamAuthJsonHeaders(session),
        ...forwardIdempotency(req),
      },
      body: body || undefined,
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  const license = mockLicenseById(params.id);
  if (!license) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Licença não encontrada." }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { delta?: unknown; justificativa?: unknown };
  if (!Number.isInteger(body.delta) || (body.delta as number) === 0 || Math.abs(body.delta as number) > 100) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Delta inválido (inteiro ≠ 0, |delta| ≤ 100)." },
      { status: 422 },
    );
  }
  if (typeof body.justificativa !== "string" || body.justificativa.trim().length < 10) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Justificativa deve ter ao menos 10 caracteres." },
      { status: 422 },
    );
  }
  return NextResponse.json({ machinesAllowed: license.machinesAllowed + (body.delta as number) });
}

function forwardIdempotency(req: NextRequest): Record<string, string> {
  const v = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
  return v ? { "Idempotency-Key": v } : {};
}
