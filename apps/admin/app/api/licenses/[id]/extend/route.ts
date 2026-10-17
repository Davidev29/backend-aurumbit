import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";
import { mockLicenseById } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/licenses/:id/extend` → Nest `POST /v1/licenses/:id/extend`.
 *
 * Prorrogação IN-PLACE: estende a MESMA licença — preserva `id`, `key_hash` e
 * os vínculos de máquina que o cliente já tem (o resgate da chave vencida sem
 * trocar a chave). Diferente de `/renew`, que EMITE licença nova.
 *
 * Recalcula `graceUntil = expiresAt + 3d` (PROJECT §1) e NÃO bumpa
 * `tokenVersion`: prorrogar soma direito, nunca tira.
 *
 * 409 do upstream é a última linha e é repassado com o corpo original
 * (`REVOKED_NO_EXTEND` | `PENDING_NO_EXTEND` | `LIFETIME_NO_EXTEND`), então a
 * UI consegue explicar o motivo em pt-BR em vez de "algo deu errado".
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  const raw = (await req.json().catch(() => ({}))) as { months?: unknown; reason?: unknown; motivo?: unknown };
  const reason = typeof raw.reason === "string" ? raw.reason : typeof raw.motivo === "string" ? raw.motivo : "";
  const months = typeof raw.months === "number" ? Math.trunc(raw.months) : Number.NaN;

  if (API_INTERNAL_URL) {
    // `ExtendLicenseDto`: {months 1..12, reason >= 10} — whitelist estrita.
    if (!Number.isInteger(months) || months < 1 || months > 12) {
      return NextResponse.json(
        { code: "UNPROCESSABLE", message: "Meses deve ser inteiro entre 1 e 12." },
        { status: 422 },
      );
    }
    if (reason.trim().length < 10) {
      return NextResponse.json(
        { code: "UNPROCESSABLE", message: "Justificativa deve ter ao menos 10 caracteres." },
        { status: 422 },
      );
    }
    let upstream: Response;
    try {
      upstream = await fetch(`${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(params.id)}/extend`, {
        method: "POST",
        headers: { ...upstreamAuthJsonHeaders(session), ...forwardIdempotency(req) },
        body: JSON.stringify({ months, reason: reason.trim() }),
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

  // Stub (sem `API_INTERNAL_URL`): mutação SINTÉTICA em memória, espelhando as
  // regras do Nest (revoked/vitalícia = 409) p/ a UI não mentir sobre o que é
  // possível — mas o resultado NÃO volta ao servidor.
  const license = mockLicenseById(params.id);
  if (!license) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Licença não encontrada." }, { status: 404 });
  }
  if (reason.trim().length < 10) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Justificativa deve ter ao menos 10 caracteres." },
      { status: 422 },
    );
  }
  if (!Number.isInteger(months) || months < 1 || months > 12) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "Meses deve ser inteiro entre 1 e 12." },
      { status: 422 },
    );
  }
  if (license.status === "revoked") {
    return NextResponse.json(
      { code: "CONFLICT", message: "Licença revogada não pode ser prorrogada." },
      { status: 409 },
    );
  }
  const previousExpiresAt = license.expiresAt;
  const base = Math.max(Date.now(), new Date(license.expiresAt).getTime());
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + months);
  license.expiresAt = d.toISOString();
  license.graceUntil = new Date(d.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  license.status = "active";
  license.degraded = false;
  return NextResponse.json(
    { license: { ...license }, previousExpiresAt, stub: true },
    { status: 200 },
  );
}

function forwardIdempotency(req: NextRequest): Record<string, string> {
  const v = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
  return v ? { "Idempotency-Key": v } : {};
}
