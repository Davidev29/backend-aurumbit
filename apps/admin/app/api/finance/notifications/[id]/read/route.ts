import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiUrlFor } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

/**
 * BFF `POST /api/finance/notifications/:id/read` → Nest
 * `POST /v1/finance/notifications/:id/read` (exige `finance.read`,
 * idempotente).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const orgId = req.headers.get("x-org-id") ?? "";

  if (API_INTERNAL_URL) {
    const upstream = await fetch(
      `${API_INTERNAL_URL}/v1/finance/notifications/${encodeURIComponent(params.id)}/read`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-org-id": orgId } : {}),
          ...(session ? { Cookie: `aurum_session=${session}` } : {}),
        },
      },
    );
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  return NextResponse.json(null);
}
