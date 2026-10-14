import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import { resolveCustomerNames, toInvoiceView, type NestInvoiceRow } from "@/lib/billing/map";
import { mockInvoicePage } from "@/lib/mocks";
import type { InvoiceStatus } from "@/lib/types";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const STATUSES: InvoiceStatus[] = ["DRAFT", "PENDING", "PAID", "OVERDUE", "REFUNDED", "CANCELLED"];

/**
 * BFF `GET /api/billing/invoices?status=&dueFrom=&dueTo=&cursor=` →
 * Nest `GET /v1/billing/invoices` (cursor pagination `{data, meta}`).
 * Mapeia centavos→reais, nomes de titulares e OVERDUE por vencimento.
 * Stub auditado (`lib/mocks.ts`) sem `API_INTERNAL_URL`.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;

  if (API_INTERNAL_URL) {
    try {
      const params = new URLSearchParams();
      const rawStatus = q.get("status");
      // OVERDUE é derivado na leitura (vencido = PENDING passado) — o Nest
      // filtra estados persistidos; por isso não repassa OVERDUE.
      if (rawStatus && rawStatus !== "OVERDUE" && STATUSES.includes(rawStatus as InvoiceStatus)) {
        params.set("status", rawStatus);
      }
      for (const k of ["dueFrom", "dueTo", "due_from", "due_to", "cursor", "limit"] as const) {
        const v = q.get(k);
        if (v) params.set(k === "dueFrom" ? "due_from" : k === "dueTo" ? "due_to" : k, v);
      }
      if (!params.get("limit")) params.set("limit", "20");
      const headers = upstreamAuthHeaders(session);
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/billing/invoices?${params.toString()}`, {
        headers,
      });
      const data = (await upstream.json().catch(() => ({}))) as {
        data?: NestInvoiceRow[];
        meta?: { nextCursor: string | null; limit: number };
      };
      if (!upstream.ok) {
        return NextResponse.json(data, { status: upstream.status });
      }
      const rows = Array.isArray(data.data) ? data.data : [];
      const names = await resolveCustomerNames(
        API_INTERNAL_URL,
        headers,
        rows.map((r) => r.customerId),
      );
      return NextResponse.json({
        data: rows.map((r) => toInvoiceView(r, names.get(r.customerId) ?? r.customerId)),
        meta: data.meta ?? { nextCursor: null, limit: 20 },
      });
    } catch {
      // DS §11 (anti-mock): falha real NUNCA cai em stub silencioso.
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
  }

  const rawStatus = q.get("status");
  const status = STATUSES.includes(rawStatus as InvoiceStatus) ? (rawStatus as InvoiceStatus) : null;
  return NextResponse.json(
    mockInvoicePage(
      { status, dueFrom: q.get("dueFrom"), dueTo: q.get("dueTo") },
      q.get("cursor"),
      Number(q.get("limit")) || 20,
    ),
  );
}
