import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiUrlFor, upstreamAuthHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function POST(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const key = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key") ?? newKey();
  const orgId = req.headers.get("x-org-id") ?? "";

  if (API_INTERNAL_URL) {
    try {
      const headers = upstreamAuthHeaders(session);
      headers["Content-Type"] = "application/json";
      headers["Idempotency-Key"] = key;
      if (orgId) headers["x-org-id"] = orgId;
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/expenses`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await upstream.json().catch(() => ({}));
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." }, { status: 502 });
    }
  }

  // Stub frontend-first (sem backend): ecoa despesa + job agendado.
  const id = `ap-stub-${newKey().slice(0, 8)}`;
  const barcode = typeof body.barcode === "string" ? body.barcode.replace(/\D/g, "") : "";
  const viaAsaas = body.pay_via_asaas === true && (barcode.length === 47 || barcode.length === 48);
  return NextResponse.json(
    {
      payable: { id, status: "PREVISTO" },
      job: viaAsaas
        ? {
            id: `job-stub-${id}`,
            idempotencyKey: key,
            kind: "BILL_PAY",
            payableId: id,
            barcodeMasked: barcode ? `${barcode.slice(0, 4)}…${barcode.slice(-4)} (${barcode.length}d)` : null,
            scheduleDate: body.schedule_date ?? body.due_date ?? null,
            provider: "ASAAS",
            externalId: "bill_stub_001",
            status: "SCHEDULED",
            attempts: 1,
            lastError: null,
          }
        : null,
      duplicate: false,
      viaAsaas,
    },
    { status: 201 },
  );
}