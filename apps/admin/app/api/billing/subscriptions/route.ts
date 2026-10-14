import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import {
  resolveCustomerNames,
  toSubscriptionView,
  type NestSubscriptionRow,
} from "@/lib/billing/map";
import { mockSubscriptionPage } from "@/lib/mocks";
import type { SubscriptionStatus } from "@/lib/types";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const STATUSES: SubscriptionStatus[] = ["DRAFT", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED", "TRIAL"];

/**
 * BFF `GET /api/billing/subscriptions?status=&cursor=` →
 * Nest `GET /v1/billing/subscriptions` (cursor pagination `{data, meta}`).
 * Valor/próxima cobrança vêm da fatura mais recente (enriquecido no Nest).
 * Stub auditado (`lib/mocks.ts`) sem `API_INTERNAL_URL`.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;

  if (API_INTERNAL_URL) {
    try {
      const params = new URLSearchParams();
      const rawStatus = q.get("status");
      if (rawStatus && STATUSES.includes(rawStatus as SubscriptionStatus)) {
        params.set("status", rawStatus);
      }
      for (const k of ["cursor", "limit"] as const) {
        const v = q.get(k);
        if (v) params.set(k, v);
      }
      if (!params.get("limit")) params.set("limit", "20");
      const headers = upstreamAuthHeaders(session);
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/billing/subscriptions?${params.toString()}`, {
        headers,
      });
      const data = (await upstream.json().catch(() => ({}))) as {
        data?: NestSubscriptionRow[];
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
        data: rows.map((r) => toSubscriptionView(r, names.get(r.customerId) ?? r.customerId)),
        meta: data.meta ?? { nextCursor: null, limit: 20 },
      });
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
  }

  const rawStatus = q.get("status");
  const status = STATUSES.includes(rawStatus as SubscriptionStatus)
    ? (rawStatus as SubscriptionStatus)
    : null;
  return NextResponse.json(
    mockSubscriptionPage(status, q.get("cursor"), Number(q.get("limit")) || 20),
  );
}
