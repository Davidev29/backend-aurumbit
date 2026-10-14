import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockLicenseById } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/licenses/:id/bonus` → Nest `POST /v1/licenses/:id/bonus`.
 * Exige `bonus.grant`; motivo >= 10; `endsAt null` = vitalícia revogável
 * (REQUIREMENTS §2). Sem financeiro real.
 * TODO(backend pronto): remover stub — proxy integral abaixo assume.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (API_INTERNAL_URL) {
    const body = await req.text();
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(params.id)}/bonus`, {
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
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown; endsAt?: unknown };
  if (typeof body.reason !== "string" || body.reason.trim().length < 10) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Motivo deve ter ao menos 10 caracteres." },
      { status: 422 },
    );
  }
  if (body.endsAt !== null && (typeof body.endsAt !== "string" || Number.isNaN(new Date(body.endsAt).getTime()))) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Prazo inválido (data ISO ou nulo p/ vitalícia)." },
      { status: 422 },
    );
  }
  const bonusId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
  return NextResponse.json({ bonusId });
}

function forwardIdempotency(req: NextRequest): Record<string, string> {
  const v = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
  return v ? { "Idempotency-Key": v } : {};
}
