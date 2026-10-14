import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiUrlFor } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

/**
 * BFF `GET /api/finance/expenses/:id/automation` → Nest
 * `GET /v1/finance/expenses/:id/automation` (exige `finance.read`).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const orgId = req.headers.get("x-org-id") ?? "";

  if (API_INTERNAL_URL) {
    const upstream = await fetch(
      `${API_INTERNAL_URL}/v1/finance/expenses/${encodeURIComponent(params.id)}/automation`,
      {
        headers: {
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
