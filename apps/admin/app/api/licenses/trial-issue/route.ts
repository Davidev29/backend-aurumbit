import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

/**
 * BFF `POST /api/licenses/trial-issue` → Nest `POST /v1/licenses/trial-issue`.
 * Seção Promocionais/Demo: lote sem conta (trial horas/dias ou lifetime).
 * Exige `product.manage` na UI; backend exige `x-role: admin`.
 */
export async function POST(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const body = (await req.json().catch(() => ({}))) as {
    productId?: unknown;
    planId?: unknown;
    qty?: unknown;
    maxDevices?: unknown;
    expiresInHours?: unknown;
    infinite?: unknown;
    ownerLabel?: unknown;
    note?: unknown;
  };

  if (typeof body.productId !== "string" || !body.productId.trim()) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "productId é obrigatório." },
      { status: 422 },
    );
  }
  const qty = body.qty === undefined ? 1 : body.qty;
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 100) {
    return NextResponse.json(
      { code: "UNPROCESSABLE", message: "qty deve ser inteiro entre 1 e 100." },
      { status: 422 },
    );
  }
  const infinite = body.infinite === true;
  if (!infinite) {
    if (typeof body.expiresInHours !== "number" || !Number.isInteger(body.expiresInHours) || body.expiresInHours < 1 || body.expiresInHours > 8760) {
      return NextResponse.json(
        { code: "UNPROCESSABLE", message: "expiresInHours deve ser inteiro entre 1 e 8760 (ou infinite=true)." },
        { status: 422 },
      );
    }
  }

  if (!API_INTERNAL_URL) {
    // Stub honesto: gera máscaras locais, sem plaintext real.
    const batchId = Math.random().toString(36).slice(2, 10);
    const items = Array.from({ length: qty as number }, (_, i) => ({
      licenseId: `trial-${batchId}-${i + 1}`,
      key: "STUB-SEM-BACKEND",
      keyMasked: "AURUM-••••-••••-STUB",
      expiresAt: infinite ? null : new Date(Date.now() + (body.expiresInHours as number) * 3600_000).toISOString(),
    }));
    return NextResponse.json(
      { batchId, kind: infinite ? "lifetime" : "trial", expiresAt: items[0]?.expiresAt ?? null, items, stub: true },
      { status: 201 },
    );
  }

  try {
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/licenses/trial-issue`, {
      method: "POST",
      headers: {
        ...upstreamAuthJsonHeaders(session),
        "Idempotency-Key": req.headers.get("Idempotency-Key") ?? crypto.randomUUID(),
      },
      body: JSON.stringify({
        productId: (body.productId as string).trim(),
        ...(typeof body.planId === "string" && body.planId.trim() ? { planId: body.planId.trim() } : {}),
        qty,
        maxDevices: typeof body.maxDevices === "number" ? body.maxDevices : 1,
        ...(infinite ? { infinite: true } : { expiresInHours: body.expiresInHours }),
        ...(typeof body.ownerLabel === "string" && body.ownerLabel.trim() ? { ownerLabel: body.ownerLabel.trim() } : {}),
        ...(typeof body.note === "string" && body.note.trim() ? { note: body.note.trim() } : {}),
      }),
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
      { status: 502 },
    );
  }
}
