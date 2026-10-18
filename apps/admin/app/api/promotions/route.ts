import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthJsonHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");
  if (!productId) return NextResponse.json([]);
  const session = req.cookies.get("aurum_session")?.value ?? "";
  if (!API_INTERNAL_URL) return NextResponse.json([]);
  try {
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/promotions?productId=${encodeURIComponent(productId)}`, {
      headers: upstreamAuthJsonHeaders(session),
    });
    const data = await upstream.json().catch(() => ([]));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const body = await req.json().catch(() => ({}));
  if (!API_INTERNAL_URL) {
    return NextResponse.json({ id: "stub-promo", promoCode: "AURUM-STUB-****", stub: true }, { status: 201 });
  }
  try {
    const upstream = await fetch(`${API_INTERNAL_URL}/v1/promotions`, {
      method: "POST",
      headers: upstreamAuthJsonHeaders(session),
      body: JSON.stringify(body),
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível." }, { status: 502 });
  }
}
