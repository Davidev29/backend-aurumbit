"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Pager, Table, Td, Th } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { BillingExportButton } from "@/components/billing/BillingExportButton";
import { InvoiceBadge } from "@/components/billing/InvoiceBadge";
import { RefundDialog } from "@/components/billing/RefundDialog";
import { TraceabilityDrawer } from "@/components/billing/TraceabilityDrawer";
import { RequirePerm, useCan } from "@/lib/auth/permissions";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { getInvoice, listAuditByCorrelation, listInvoices } from "@/lib/billing";
import { formatBRL, formatDateInTZ, formatDateTimeInTZ } from "@/lib/format";
import type {
  AuditEventView,
  InvoiceDetail,
  InvoiceStatus,
  InvoiceView,
  Page,
} from "@/lib/types";

const STATUS_OPTIONS: Array<{ value: "" | InvoiceStatus; label: string }> = [
  { value: "", label: "Todos os estados" },
  { value: "DRAFT", label: "Rascunho" },
  { value: "PENDING", label: "Pendente" },
  { value: "PAID", label: "Paga" },
  { value: "OVERDUE", label: "Vencida" },
  { value: "REFUNDED", label: "Estornada" },
  { value: "CANCELLED", label: "Cancelada" },
];

const SELECT_CLASS =
  "w-full min-h-[44px] px-3 rounded-base text-body text-text1 bg-bg2 border border-line2 focus-ring";

/**
 * Cobranças (Fase 4 —REQUIREMENTS §3).
 * Gate: `billing.read` (manager+). Estorno exige `billing.manage` +
 * confirmação + motivo. Sem financeiro realizado (Fase 5).
 */
export default function CobrancasPage() {
  const [status, setStatus] = useState<"" | InvoiceStatus>("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const [history, setHistory] = useState<Array<string | null>>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const [page, setPage] = useState<Page<InvoiceView> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cursor = history[pageIdx] ?? null;

  function resetPaging() {
    setHistory([null]);
    setPageIdx(0);
  }

  function clearFilters() {
    setStatus("");
    setDueFrom("");
    setDueTo("");
    setQuery("");
    resetPaging();
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listInvoices(
      {
        status: status || null,
        dueFrom: dueFrom ? `${dueFrom}T00:00:00.000Z` : null,
        dueTo: dueTo ? `${dueTo}T23:59:59.999Z` : null,
      },
      cursor,
    )
      .then((p) => {
        if (!cancelled) setPage(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, dueFrom, dueTo, cursor, nonce]);

  // Busca com debounce 300ms: filtro client-side da página carregada
  // (o BFF/lista ainda não expõe query — `InvoiceFilters` só tem
  // estado/vencimento; paginação por cursor preservada).
  const q = debouncedQuery.trim().toLowerCase();
  const rows = (page?.data ?? []).filter(
    (inv) =>
      q === "" ||
      inv.id.toLowerCase().includes(q) ||
      inv.customerName.toLowerCase().includes(q),
  );

  return (
    <RequirePerm perm="billing.read">
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="m-0 text-title-page text-text1">Cobranças</h1>
          <BillingExportButton scope="invoices" />
        </div>
        <form
          aria-label="Filtros de cobranças"
          className="mb-4 flex flex-wrap items-end gap-4"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="min-w-[12rem] flex-1 basis-48">
            <Field label="Buscar" htmlFor="cob-busca" hint="Filtra a página por fatura ou cliente.">
              <Input
                id="cob-busca"
                type="search"
                placeholder="Ex.: INV-2026 ou nome do cliente"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
          </div>
          <div className="min-w-[12rem]">
            <Field label="Estado" htmlFor="cob-status">
              <select
                id="cob-status"
                className={SELECT_CLASS}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as "" | InvoiceStatus);
                  resetPaging();
                }}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="min-w-[12rem]">
            <Field label="Vencimento de" htmlFor="cob-from">
              <Input
                id="cob-from"
                type="date"
                value={dueFrom}
                onChange={(e) => {
                  setDueFrom(e.target.value);
                  resetPaging();
                }}
              />
            </Field>
          </div>
          <div className="min-w-[12rem]">
            <Field label="Vencimento até" htmlFor="cob-to">
              <Input
                id="cob-to"
                type="date"
                value={dueTo}
                onChange={(e) => {
                  setDueTo(e.target.value);
                  resetPaging();
                }}
              />
            </Field>
          </div>
        </form>

        {loading ? (
          <Skeleton height="12rem" label="Carregando cobranças" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />
        ) : !page || rows.length === 0 ? (
          <EmptyState
            title="Nenhuma cobrança encontrada"
            message="Ajuste os filtros de estado ou vencimento."
            action={
              <Button type="button" variant="secondary" onClick={clearFilters}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <>
            <Table
              caption="Faturas (paginação por cursor)"
              head={
                <>
                  <Th>Fatura</Th>
                  <Th>Cliente</Th>
                  <Th numeric>Valor</Th>
                  <Th>Vencimento</Th>
                  <Th>Estado</Th>
                  <Th>Detalhe</Th>
                </>
              }
            >
              {rows.map((inv) => (
                <tr key={inv.id}>
                  <Td mono>{inv.id}</Td>
                  <Td>{inv.customerName}</Td>
                  <Td numeric>{formatBRL(inv.amount)}</Td>
                  <Td>{formatDateInTZ(inv.dueDate)}</Td>
                  <Td>
                    <InvoiceBadge status={inv.status} />
                  </Td>
                  <Td>
                    <Button type="button" variant="secondary" onClick={() => setSelectedId(inv.id)}>
                      Ver
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
            <Pager
              hasPrev={pageIdx !== 0}
              hasNext={Boolean(page.meta.nextCursor)}
              status={`Página ${pageIdx + 1}`}
              onPrev={() => setPageIdx((i) => Math.max(0, i - 1))}
              onNext={() => {
                const next = page.meta.nextCursor;
                if (!next) return;
                setHistory((h) => [...h.slice(0, pageIdx + 1), next]);
                setPageIdx((i) => i + 1);
              }}
            />
          </>
        )}

        {selectedId && (
          <InvoiceDetailPanel
            invoiceId={selectedId}
            onClose={() => setSelectedId(null)}
            onChanged={() => {
              setSelectedId(null);
              setNonce((n) => n + 1);
            }}
          />
        )}
      </div>
    </RequirePerm>
  );
}

function InvoiceDetailPanel({
  invoiceId,
  onClose,
  onChanged,
}: {
  invoiceId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const canRefund = useCan("billing.manage");
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [audit, setAudit] = useState<AuditEventView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getInvoice(invoiceId)
      .then(async (d) => {
        if (cancelled) return;
        setDetail(d);
        try {
          const a = await listAuditByCorrelation(d.invoice.correlationId);
          if (!cancelled) setAudit(a.data);
        } catch {
          if (!cancelled) setAudit([]);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar detalhe.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  if (loading) {
    return (
      <div className="mt-4 rounded-card border border-line1 bg-bg1 p-5 shadow-1" aria-label="Carregando detalhe">
        <Skeleton height="8rem" label="Carregando detalhe da fatura" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="mt-4 rounded-card border border-line1 bg-bg1 p-5 shadow-1">
        <ErrorState message={error ?? "Fatura não encontrada."} />
        <Button type="button" variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </div>
    );
  }

  const { invoice, payments } = detail;
  const refundable = invoice.status === "PAID";

  return (
    <section
      className="mt-4 rounded-card border border-line1 bg-bg1 p-5 shadow-1"
      aria-label={`Detalhe da fatura ${invoice.id}`}
    >
      <h2 className="mt-0 flex flex-wrap items-center gap-2 text-section text-text1">
        Fatura <code className="font-mono tnum text-[0.85em]">{invoice.id}</code>{" "}
        <InvoiceBadge status={invoice.status} />
      </h2>
      <dl className="m-0">
        <dt className="text-callout text-text2">Cliente</dt>
        <dd className="mb-2 ml-0 text-body text-text1">{invoice.customerName}</dd>
        <dt className="text-callout text-text2">Valor / vencimento</dt>
        <dd className="mb-2 ml-0 text-body text-text1">
          {formatBRL(invoice.amount)} · {formatDateTimeInTZ(invoice.dueDate)}
        </dd>
        <dt className="text-callout text-text2">Charge Asaas</dt>
        <dd className="mb-2 ml-0 text-body text-text1">
          <code className="font-mono tnum text-[0.85em]">{invoice.externalId}</code>
        </dd>
        <dt className="text-callout text-text2">CorrelationId</dt>
        <dd className="m-0 text-body text-text1">
          <code className="font-mono tnum text-[0.85em]">{invoice.correlationId}</code>
        </dd>
      </dl>

      <h3 className="text-headline text-text1">Pagamentos ({payments.length})</h3>
      {payments.length === 0 ? (
        <p className="text-callout text-text2">Nenhum pagamento vinculado (fatura ainda não paga).</p>
      ) : (
        <Table
          caption={`Pagamentos da fatura ${invoice.id}`}
          head={
            <>
              <Th>ID</Th>
              <Th numeric>Valor</Th>
              <Th>Estado</Th>
              <Th>Método</Th>
              <Th>Pago em</Th>
            </>
          }
        >
          {payments.map((p) => (
            <tr key={p.id}>
              <Td mono>{p.id}</Td>
              <Td numeric>{formatBRL(p.amount)}</Td>
              <Td>
                <Badge tone="neutral">
                  <span className="font-mono tnum text-[0.85em]">{p.status}</span>
                </Badge>
              </Td>
              <Td>{p.method ?? "—"}</Td>
              <Td>{p.paidAt ? formatDateTimeInTZ(p.paidAt) : "—"}</Td>
            </tr>
          ))}
        </Table>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={!refundable || !canRefund}
          title={
            !canRefund
              ? "Requer permissão billing.manage"
              : !refundable
                ? "Só faturas pagas podem ser estornadas"
                : "Estornar fatura (auditado)"
          }
          onClick={() => setRefundOpen(true)}
        >
          Estornar
        </Button>
        <Button type="button" variant="secondary" onClick={() => setTraceOpen(true)}>
          Rastrear charge → fatura → auditoria
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </div>

      {refundOpen && (
        <RefundDialog invoiceId={invoice.id} amount={invoice.amount} onClose={() => setRefundOpen(false)} onDone={onChanged} />
      )}
      {traceOpen && (
        <TraceabilityDrawer invoice={invoice} payments={payments} auditEvents={audit} onClose={() => setTraceOpen(false)} />
      )}
    </section>
  );
}
