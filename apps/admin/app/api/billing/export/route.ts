import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { upstreamAuthHeaders } from "@/lib/api/upstream";
import { resolveCustomerNames, type NestInvoiceRow, type NestSubscriptionRow } from "@/lib/billing/map";
import { mockBillingCsv } from "@/lib/mocks";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL;
const SCOPES = ["invoices", "subscriptions", "audit"] as const;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  // Sanitiza CSV: `;` vira `,` e quebras de linha viram espaço (célula nunca
  // quebra a linha — anti CSV-injection leve p/ export administrativo).
  return String(v).replace(/;/g, ",").replace(/[\r\n]+/g, " ");
}

function line(cells: unknown[]): string {
  return cells.map(cell).join(";") + "\n";
}

/**
 * BFF `GET /api/billing/export?scope=` (exige `billing.manage` na UI).
 * Real: compõe o CSV a partir das listas reais (sem endpoint dedicado no
 * Nest). Stub `;`-separado sem `API_INTERNAL_URL`.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("aurum_session")?.value ?? "";
  const q = req.nextUrl.searchParams;
  const scope = q.get("scope");

  if (!SCOPES.includes(scope as (typeof SCOPES)[number])) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "scope deve ser invoices, subscriptions ou audit." },
      { status: 400 },
    );
  }

  if (API_INTERNAL_URL) {
    try {
      const headers = upstreamAuthHeaders(session);
      const csv = (header: string, rows: unknown[][]) => header + rows.map(line).join("");
      if (scope === "invoices") {
        const upstream = await fetch(`${API_INTERNAL_URL}/v1/billing/invoices?limit=100`, { headers });
        const data = (await upstream.json().catch(() => ({}))) as { data?: NestInvoiceRow[] };
        if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });
        const rows = Array.isArray(data.data) ? data.data : [];
        const names = await resolveCustomerNames(
          API_INTERNAL_URL,
          headers,
          rows.map((r) => r.customerId),
        );
        return csvFile(
          `billing-invoices.csv`,
          csv("id;cliente;valor;moeda;estado;vencimento;charge;correlationId\n", rows.map((r) => [
            r.id,
            names.get(r.customerId) ?? r.customerId,
            Math.round(r.amountCents) / 100,
            "BRL",
            r.status,
            r.dueDate ?? "",
            r.asaasInvoiceId ?? r.orderId ?? r.id,
            `inv:${r.id}`,
          ])),
        );
      }
      if (scope === "subscriptions") {
        const upstream = await fetch(`${API_INTERNAL_URL}/v1/billing/subscriptions?limit=100`, {
          headers,
        });
        const data = (await upstream.json().catch(() => ({}))) as { data?: NestSubscriptionRow[] };
        if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });
        const rows = Array.isArray(data.data) ? data.data : [];
        const names = await resolveCustomerNames(
          API_INTERNAL_URL,
          headers,
          rows.map((r) => r.customerId),
        );
        return csvFile(
          `billing-subscriptions.csv`,
          csv("id;cliente;plano;estado;valor;moeda;proxima_cobranca;correlationId\n", rows.map((r) => [
            r.id,
            names.get(r.customerId) ?? r.customerId,
            r.planRef ?? "",
            r.status,
            r.lastInvoiceAmountCents != null ? Math.round(r.lastInvoiceAmountCents) / 100 : "",
            "BRL",
            r.lastInvoiceDueDate ?? r.currentPeriodEnd ?? "",
            `sub:${r.id}`,
          ])),
        );
      }
      // Audit: trilha PG append-only (`GET /v1/audit/events`).
      const upstream = await fetch(`${API_INTERNAL_URL}/v1/audit/events?limit=100`, { headers });
      const data = (await upstream.json().catch(() => ({}))) as {
        data?: Array<{
          id?: string;
          actorId?: string | null;
          action?: string;
          entity?: string;
          entityId?: string | null;
          metadata?: Record<string, unknown>;
          createdAt?: string;
        }>;
      };
      if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });
      const events = Array.isArray(data.data) ? data.data : [];
      return csvFile(
        `billing-audit.csv`,
        csv("id;ator;acao;recurso;recursoId;correlationId;ocorrido_em\n", events.map((e) => [
          e.id ?? "",
          e.actorId ?? "",
          e.action ?? "",
          e.entity ?? "",
          e.entityId ?? "",
          (typeof e.metadata?.correlationId === "string" ? e.metadata.correlationId : null) ?? e.entityId ?? "",
          e.createdAt ?? "",
        ])),
      );
    } catch {
      return NextResponse.json(
        { code: "UPSTREAM_UNAVAILABLE", message: "Backend indisponível. Tente novamente." },
        { status: 502 },
      );
    }
  }

  // TODO(backend pronto Fase 6): gerar no Nest (filtros aplicados + audit `billing.export`).
  return new NextResponse(mockBillingCsv(scope as "invoices" | "subscriptions" | "audit"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="billing-${scope}.csv"`,
    },
  });
}

function csvFile(filename: string, csv: string): NextResponse {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
