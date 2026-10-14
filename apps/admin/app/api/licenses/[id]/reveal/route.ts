import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import { mockLicenseById } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/licenses/:id/reveal` → Nest `POST /v1/licenses/:id/reveal`.
 * Revelação auditada (PROJECT §2): exige `license.read` + MFA, rate-limit 10/h
 * no backend, gera `AuditEvent license.reveal`. Sem endpoint bulk.
 * TODO(backend pronto): este stub sai — proxy integral abaixo assume.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";

  if (API_INTERNAL_URL) {
    // Core `RevealLicenseDto`: {reason?} + `LicenseReadGuard`. Envia escopo
    // `license.read` SEM `x-role: admin` (admin humano exigiria step-up MFA
    // `x-mfa: verified`, que o BFF não pode provar — TODO MFA real).
    const raw = (await req.json().catch(() => ({}))) as { motivo?: unknown; reason?: unknown };
    const reason =
      typeof raw.reason === "string" && raw.reason.trim()
        ? raw.reason.trim()
        : typeof raw.motivo === "string" && raw.motivo.trim()
          ? raw.motivo.trim()
          : undefined;
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/licenses/${encodeURIComponent(params.id)}/reveal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...upstreamAuthHeaders(session, { withRole: false }),
        "x-scope": "license.read",
        ...forwardIdempotency(req),
      },
      body: JSON.stringify(reason ? { reason } : {}),
    });
    const data = (await upstream.json().catch(() => ({}))) as {
      licenseId?: string;
      key?: string;
      keyMasked?: string;
      revealedAt?: string;
    };
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    // Estabiliza o contrato da UI (`{key, auditId}`): sem id real do Nest.
    return NextResponse.json(
      {
        key: data.key,
        keyMasked: data.keyMasked,
        auditId: `reveal-${params.id}-${data.revealedAt ?? Date.now()}`,
      },
      { status: upstream.status },
    );
  }

  const license = mockLicenseById(params.id);
  if (!license) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Licença não encontrada." }, { status: 404 });
  }
  // Stub: deriva pseudo-plaintext determinística do sufixo (nunca loga a chave).
  const auditId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
  const key = `AURUM-${license.keyPrefix}${license.keyLast4}-STUB-${license.keyLast4}`;
  const res = NextResponse.json({ key, auditId });
  res.headers.set("X-Aurum-Audit", auditId);
  return res;
}

function forwardIdempotency(req: NextRequest): Record<string, string> {
  const v = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
  return v ? { "Idempotency-Key": v } : {};
}
