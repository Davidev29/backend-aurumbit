import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockTransactionPage } from "@/lib/mocks";
import type { TransactionKind } from "@/lib/types";

import { apiUrlFor } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");
const KINDS: TransactionKind[] = ["RECEITA", "DESPESA"];

/**
 * BFF `GET /api/finance/transactions?kind=&category=&product=&from=&to=&cursor=` →
 * Nest `GET /v1/finance/transactions` (extrato realizado, exige `finance.read`).
 * TODO(backend pronto): este stub sai — proxy integral abaixo assume.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;

  if (API_INTERNAL_URL) {
    const upstream = await fetch(
      `${API_INTERNAL_URL}/v1/finance/transactions?${q.toString()}`,
      { headers: { ...(session ? { Cookie: `aurum_session=${session}` } : {}) } },
    );
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  }

  const rawKind = q.get("kind");
  return NextResponse.json(
    mockTransactionPage(
      {
        kind: KINDS.includes(rawKind as TransactionKind) ? (rawKind as TransactionKind) : null,
        status: null,
        category: q.get("category"),
        product: q.get("product"),
        from: q.get("from"),
        to: q.get("to"),
      },
      q.get("cursor"),
      Number(q.get("limit")) || 20,
    ),
  );
}
