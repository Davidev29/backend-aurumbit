import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiUrlFor } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");

/**
 * BFF `GET /api/finance/notifications` → Nest `GET /v1/finance/notifications`
 * (exige `finance.read`). Alimenta o sino do terminal.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const orgId = req.headers.get("x-org-id") ?? "";
  const q = req.nextUrl.searchParams.toString();

  if (API_INTERNAL_URL) {
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/notifications${q ? `?${q}` : ""}`, {
      headers: {
        ...(orgId ? { "x-org-id": orgId } : {}),
        ...(session ? { Cookie: `aurum_session=${session}` } : {}),
      },
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  return NextResponse.json({ data: [], unread: 0 });
}
