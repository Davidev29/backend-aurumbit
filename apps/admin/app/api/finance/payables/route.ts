import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mockPayablePage } from "@/lib/mocks";
import { apiUrlFor, upstreamAuthHeaders } from "@/lib/api/upstream";

const API_INTERNAL_URL = apiUrlFor("finance");
const STATUSES = ["PREVISTO", "PENDENTE", "PAGO", "VENCIDO", "CANCELADO"];

function mapPayable(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    supplier: String(row.supplier ?? row.sourceId ?? "Fornecedor"),
    category: String(row.category ?? row.categoryId ?? "Geral"),
    product: row.product ? String(row.product) : undefined,
    amount: Number(row.amountCents ?? row.amount ?? 0) / 100,
    currency: "BRL",
    status: String(row.status ?? "PREVISTO"),
    dueDate: String(row.dueDate ?? row.due_date ?? new Date().toISOString()),
    paidAt: row.paidAt ? String(row.paidAt) : (row.paid_at ? String(row.paid_at) : null),
    recurrence: String(row.recurrence ?? "MENSAL"),
    correlationId: String(row.correlationId ?? row.correlation_id ?? row.sourceId ?? row.id),
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
      const rawStatus = q.get("status");
      if (rawStatus && STATUSES.includes(rawStatus)) params.set("status", rawStatus);
      const from = q.get("from");
      const to = q.get("to");
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("limit", "500");
      const headers = upstreamAuthHeaders(session);
      if (orgId) headers["x-org-id"] = orgId;
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/finance/payables?${params.toString()}`, { headers });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });

      const rows = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
      const mapped = rows.map((r: Record<string, unknown>) => mapPayable(r))
        .sort((a: { dueDate: string; id: string }, b: { dueDate: string; id: string }) => (a.dueDate < b.dueDate ? -1 : 1));

      // cursor pagination by id
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

  const rawStatus = q.get("status");
  return NextResponse.json(
    mockPayablePage(
      {
        status: STATUSES.includes(rawStatus ?? "") ? rawStatus : null,
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