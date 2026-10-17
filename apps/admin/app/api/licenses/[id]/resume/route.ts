import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockLicenseById } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/licenses/:id/resume` → Nest `POST /v1/licenses/:id/resume`.
 *
 * Reativação: devolve a licença suspensa ao estado `active`. O upstream emite
 * outbox `LicenseResumed` — sem ele a reativação era invisível no histórico
 * (parte do bug "chaves defasadas sem rastro").
 *
 * Só faz sentido em `suspended`: o upstream responde 409 em qualquer outro
 * estado, e o 409 é repassado com o corpo original.
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
      upstream = await fetch(`${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(params.id)}/resume`, {
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

  // Stub (sem `API_INTERNAL_URL`): espelha a regra do Nest (só suspensa volta).
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
  if (license.status !== "suspended") {
    return NextResponse.json(
      { code: "CONFLICT", message: "Só licença suspensa pode ser reativada." },
      { status: 409 },
    );
  }
  // Reativar NÃO ressuscita prazo vencido: se o `expiresAt` já passou, a
  // licença volta e o relógio a deriva para grace/expired na mesma hora. A UI
  // mostra isso; o extend é o caminho para devolver vigência.
  license.status = new Date(license.expiresAt).getTime() < Date.now() ? "expired" : "active";
  return NextResponse.json({ ...license, stub: true });
}

function forwardIdempotency(req: NextRequest): Record<string, string> {
  const v = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
  return v ? { "Idempotency-Key": v } : {};
}
