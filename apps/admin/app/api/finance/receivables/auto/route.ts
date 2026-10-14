import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiUrlFor } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * BFF `POST /api/finance/receivables/auto` → Nest
 * `POST /v1/finance/receivables/auto` (exige `finance.manage`, só admin).
 * Cria o recebível e emite a cobrança Asaas automaticamente.
 * Repassa `Idempotency-Key` (PROJECT §5); gera uma se ausente.
 */
export async function POST(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();
  const orgId = req.headers.get("x-org-id") ?? "";

  if (API_INTERNAL_URL) {
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/receivables/auto`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        ...(orgId ? { "x-org-id": orgId } : {}),
        ...(session ? { Cookie: `aurum_session=${session}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  // Stub frontend-first (sem backend): recebível + cobrança sintética.
  const id = `ar-stub-${newKey().slice(0, 8)}`;
  return NextResponse.json(
    {
      receivable: { id, status: "PENDENTE" },
      job: {
        id: `job-stub-${id}`,
        idempotencyKey: key,
        kind: "AUTO_CHARGE",
        receivableId: id,
        provider: "ASAAS",
        externalId: "pay_stub_001",
        status: "DONE",
        attempts: 1,
        lastError: null,
      },
      duplicate: false,
      chargeId: "pay_stub_001",
      identificationField: null,
    },
    { status: 201 },
  );
}
