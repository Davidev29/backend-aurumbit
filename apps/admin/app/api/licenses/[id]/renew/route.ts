import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockLicenseById } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/licenses/:id/renew` → Nest `POST /v1/licenses/:id/renew`.
 * Renovação em graça mantém continuidade (`starts_at = max(now, expires_at)` —
 * PROJECT §1). Exige `license.adjust`. Sem financeiro real.
 * TODO(backend pronto): remover stub — proxy integral abaixo assume.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (API_INTERNAL_URL) {
    // Core `RenewLicenseDto`: {kind?: monthly|annual} — omitido herda da
    // anterior. Mapeia o `{months: 1|12}` da UI.
    const raw = (await req.json().catch(() => ({}))) as { months?: unknown };
    const kind = raw.months === 12 ? "annual" : raw.months === 1 ? "monthly" : undefined;
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(params.id)}/renew`, {
      method: "POST",
      headers: {
        ...upstreamAuthJsonHeaders(session),
        ...forwardIdempotency(req),
      },
      body: JSON.stringify(kind ? { kind } : {}),
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  const license = mockLicenseById(params.id);
  if (!license) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Licença não encontrada." }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { months?: unknown };
  if (body.months !== 1 && body.months !== 12) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Período inválido (1 ou 12 meses)." },
      { status: 422 },
    );
  }
  // Stub: `starts_at = max(now, expires_at)` + meses calendário UTC.
  const base = Math.max(Date.now(), new Date(license.expiresAt).getTime());
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + (body.months as number));
  return NextResponse.json({ expiresAt: d.toISOString() });
}

function forwardIdempotency(req: NextRequest): Record<string, string> {
  const v = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
  return v ? { "Idempotency-Key": v } : {};
}
