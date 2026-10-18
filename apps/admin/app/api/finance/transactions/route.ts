import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockTransactionPage } from "@/lib/mocks";
import type { TransactionKind } from "@/lib/types";
import { apiUrlFor, upstreamAuthHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");
const KINDS: TransactionKind[] = ["RECEITA", "DESPESA"];

function backendKind(k: string | null): string | null {
  if (k === "RECEITA") return "INCOME";
  if (k === "DESPESA") return "EXPENSE";
  return null;
}

function mapTransaction(row: Record<string, unknown>) {
  const kind = String(row.kind ?? "") === "INCOME" ? "RECEITA" : "DESPESA";
  const sourceId = String(row.receivableId ?? row.receivable_id ?? row.payableId ?? row.payable_id ?? row.id);
  const sourceKind = row.receivableId || row.receivable_id ? "receivable" : "payable";
  return {
    id: String(row.id),
    kind,
    description: String(row.description ?? (kind === "RECEITA" ? "Receita realizada" : "Despesa realizada")),
    category: String(row.category ?? row.categoryId ?? row.category_id ?? "Geral"),
    product: row.product ? String(row.product) : undefined,
    amount: Number(row.amountCents ?? row.amount ?? 0) / 100,
    currency: "BRL",
    settledAt: String(row.occurredAt ?? row.occurred_at ?? row.settledAt ?? new Date().toISOString()),
    sourceId,
    sourceKind,
    correlationId: String(row.correlationId ?? row.correlation_id ?? row.idempotencyKey ?? row.idempotency_key ?? row.id),
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
  };
}

export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;
  const orgId = req.headers.get("x-org-id") ?? "";
  const cursor = q.get("cursor");
  const limit = Number(q.get("limit")) || 20;

  if (API_INTERNAL_URL) {
    try {
      const params = new URLSearchParams();
      const rawKind = q.get("kind");
      const bk = backendKind(rawKind);
      if (bk) params.set("kind", bk);
      const from = q.get("from");
      const to = q.get("to");
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("limit", "500");
      const headers = upstreamAuthHeaders(session);
      if (orgId) headers["x-org-id"] = orgId;
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/transactions?${params.toString()}`, { headers });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });

      const rows = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
      const mapped = rows.map((r: Record<string, unknown>) => mapTransaction(r))
        .sort((a: { settledAt: string; id: string }, b: { settledAt: string; id: string }) => (a.settledAt < b.settledAt ? 1 : -1));

      const start = cursor ? mapped.findIndex((r: { id: string }) => r.id === cursor) + 1 : 0;
      const fromIdx = Math.max(start, 0);
      const slice = mapped.slice(fromIdx, fromIdx + limit);
      const last = slice[slice.length - 1];
      const hasMore = !!last && mapped.findIndex((r: { id: string }) => r.id === last.id) < mapped.length - 1;

      return NextResponse.json({ data: slice, meta: { nextCursor: hasMore && last ? last.id : null, limit } });
    } catch {
      return NextResponse.json({ code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." }, { status: 502 });
    }
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