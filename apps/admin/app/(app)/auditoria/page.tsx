"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BillingExportButton } from "@/components/billing/BillingExportButton";
import { MaskedJson } from "@/components/billing/MaskedJson";
import { TraceabilityDrawer } from "@/components/billing/TraceabilityDrawer";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { EmptyState, ErrorState, Pager, Table, Td, Th } from "@/components/ui/table";
import { RequirePerm } from "@/lib/auth/permissions";
import { getInvoice, listAuditEvents } from "@/lib/billing";
import { getFinanceTrace } from "@/lib/finance";
import { formatDateTimeInTZ } from "@/lib/format";
import type {
  AuditEventView,
  InvoiceView,
  Page,
  PayableView,
  PaymentView,
  ReceivableView,
  TransactionView,
} from "@/lib/types";

/** Recursos Fase 4 (billing) + Fase 5 (financeiro) — filtro espelha o backend. */
const RESOURCE_OPTIONS = ["", "invoice", "payment", "subscription", "payable", "receivable", "transaction", "license"];

const SELECT_CLASS =
  "min-h-[44px] rounded-base border border-line2 bg-bg2 px-3 text-body text-text1 focus-ring";

const LINK_BUTTON_CLASS =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-base border border-line2 bg-bg2 px-4 text-body text-text1 no-underline hover:border-line3 focus-ring";

/**
 * Auditoria (Fase 4 — REQUIREMENTS §4: append-only, sem UPDATE/DELETE).
 * Gate: `billing.read` (manager+). Filtros ator/recurso/correlationId/período.
 * `MaskedJson` nunca expõe PII; o link de rastro liga charge → invoice → audit.
 */
export default function AuditoriaPage() {
  return (
    <RequirePerm perm="billing.read">
      <Suspense
        fallback={
          <div
            role="status"
            aria-label="Carregando auditoria"
            className="animate-shimmer rounded-base border border-line1"
            style={{
              height: "12rem",
              background: "linear-gradient(90deg, var(--bg-2) 25%, var(--border-2) 50%, var(--bg-2) 75%)",
              backgroundSize: "200% 100%",
            }}
          />
        }
      >
        <AuditoriaInner />
      </Suspense>
    </RequirePerm>
  );
}

function AuditoriaInner() {
  const search = useSearchParams();
  const [actor, setActor] = useState("");
  const [resource, setResource] = useState("");
  const [correlationId, setCorrelationId] = useState(() => search.get("correlationId") ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [history, setHistory] = useState<Array<string | null>>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const [page, setPage] = useState<Page<AuditEventView> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [trace, setTrace] = useState<{
    invoice?: InvoiceView | null;
    payments?: PaymentView[];
    receivable?: ReceivableView | null;
    payable?: PayableView | null;
    transaction?: TransactionView | null;
    events: AuditEventView[];
  } | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);

  const cursor = history[pageIdx] ?? null;

  function resetPaging() {
    setHistory([null]);
    setPageIdx(0);
  }

  function clearFilters() {
    setActor("");
    setResource("");
    setCorrelationId("");
    setFrom("");
    setTo("");
    resetPaging();
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAuditEvents(
      {
        actor: actor || null,
        resource: resource || null,
        correlationId: correlationId || null,
        from: from ? `${from}T00:00:00.000Z` : null,
        to: to ? `${to}T23:59:59.999Z` : null,
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
  }, [actor, resource, correlationId, from, to, cursor, nonce]);

  /**
   * Abre o rastro charge → invoice → financeiro → auditoria a partir dos ids
   * do evento (Fase 4: `invoiceId`; Fase 5: `receivableId`/`payableId` via
   * `getFinanceTrace`). Funciona com dados das Fases 4–5 via `correlationId`.
   */
  async function openTrace(event: AuditEventView) {
    const meta = event.metadataMasked as Record<string, unknown>;
    const invoiceId = meta?.["invoiceId"];
    const receivableId = meta?.["receivableId"];
    const payableId = meta?.["payableId"];
    setTraceError(null);
    try {
      if (typeof invoiceId === "string") {
        const detail = await getInvoice(invoiceId);
        const events = await listAuditEvents({ correlationId: detail.invoice.correlationId }, null);
        setTrace({ invoice: detail.invoice, payments: detail.payments, events: events.data });
      } else if (typeof receivableId === "string") {
        const t = await getFinanceTrace({ receivableId });
        setTrace({
          invoice: t.invoice,
          payments: t.payments,
          receivable: t.receivable,
          payable: t.payable,
          transaction: t.transactions[0] ?? null,
          events: t.audit,
        });
      } else if (typeof payableId === "string") {
        const t = await getFinanceTrace({ payableId });
        setTrace({
          invoice: t.invoice,
          payments: t.payments,
          receivable: t.receivable,
          payable: t.payable,
          transaction: t.transactions[0] ?? null,
          events: t.audit,
        });
      }
    } catch (err) {
      setTraceError(err instanceof Error ? err.message : "Falha ao abrir rastro.");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-title-page text-text1">Auditoria</h1>
        <BillingExportButton scope="audit" />
      </div>
      <form aria-label="Filtros de auditoria" className="mb-4 flex flex-wrap gap-3" onSubmit={(e) => e.preventDefault()}>
        <Field label="Ator" htmlFor="aud-actor">
          <Input
            id="aud-actor"
            type="search"
            placeholder="Ex.: system:webhook"
            value={actor}
            onChange={(e) => {
              setActor(e.target.value);
              resetPaging();
            }}
          />
        </Field>
        <Field label="Recurso" htmlFor="aud-resource">
          <select
            id="aud-resource"
            className={SELECT_CLASS}
            value={resource}
            onChange={(e) => {
              setResource(e.target.value);
              resetPaging();
            }}
          >
            {RESOURCE_OPTIONS.map((r) => (
              <option key={r || "all"} value={r}>
                {r === "" ? "Todos" : r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="CorrelationId" htmlFor="aud-corr">
          <Input
            id="aud-corr"
            mono
            type="search"
            placeholder="corr-…"
            value={correlationId}
            onChange={(e) => {
              setCorrelationId(e.target.value);
              resetPaging();
            }}
          />
        </Field>
        <Field label="Período de" htmlFor="aud-from">
          <Input
            id="aud-from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              resetPaging();
            }}
          />
        </Field>
        <Field label="Período até" htmlFor="aud-to">
          <Input
            id="aud-to"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              resetPaging();
            }}
          />
        </Field>
      </form>

      {traceError && (
        <p className="mt-0 text-callout text-danger" role="alert">
          {traceError}
        </p>
      )}

      {loading ? (
        <div
          role="status"
          aria-label="Carregando eventos"
          className="animate-shimmer rounded-base border border-line1"
          style={{
            height: "12rem",
            background: "linear-gradient(90deg, var(--bg-2) 25%, var(--border-2) 50%, var(--bg-2) 75%)",
            backgroundSize: "200% 100%",
          }}
        />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : !page || page.data.length === 0 ? (
        <div className="rounded-card border border-line1 bg-bg1 shadow-1 p-5">
          <EmptyState
            title="Nenhum evento encontrado"
            hint="Ajuste os filtros (ator, recurso, correlationId, período)."
          />
          <div className="mt-3 flex justify-center">
            <Button variant="secondary" onClick={clearFilters} title="Limpar todos os filtros">
              Limpar filtros
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Table
            caption="Eventos de auditoria (paginação por cursor)"
            head={
              <>
                <Th>Ocorrido em</Th>
                <Th>Ator</Th>
                <Th>Ação</Th>
                <Th>Recurso</Th>
                <Th>CorrelationId</Th>
                <Th>Detalhe</Th>
              </>
            }
          >
            {page.data.map((e) => (
              <tr key={e.id}>
                <Td>{formatDateTimeInTZ(e.occurredAt)}</Td>
                <Td>{e.actor}</Td>
                <Td mono>{e.action}</Td>
                <Td>
                  {e.resource}:<code className="font-mono text-[0.85em]">{e.resourceId}</code>
                </Td>
                <Td mono>{e.correlationId}</Td>
                <Td>
                  <Button
                    variant="secondary"
                    aria-expanded={expanded === e.id}
                    title={expanded === e.id ? "Ocultar detalhe do evento" : "Ver detalhe do evento"}
                    onClick={() => setExpanded((cur) => (cur === e.id ? null : e.id))}
                  >
                    {expanded === e.id ? "Ocultar" : "Ver"}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>

          {expanded && (
            <ExpandedEvent
              event={page.data.find((e) => e.id === expanded) ?? null}
              onTrace={openTrace}
              onClose={() => setExpanded(null)}
            />
          )}

          <Pager
            hasPrev={pageIdx > 0}
            hasNext={!!page.meta.nextCursor}
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

      {trace && (
        <TraceabilityDrawer
          invoice={trace.invoice ?? null}
          payments={trace.payments ?? []}
          receivable={trace.receivable ?? null}
          payable={trace.payable ?? null}
          transaction={trace.transaction ?? null}
          auditEvents={trace.events}
          onClose={() => setTrace(null)}
        />
      )}
    </div>
  );
}

function ExpandedEvent({
  event,
  onTrace,
  onClose,
}: {
  event: AuditEventView | null;
  onTrace: (e: AuditEventView) => void;
  onClose: () => void;
}) {
  if (!event) return null;
  const meta = event.metadataMasked as Record<string, unknown>;
  const invoiceId = meta?.["invoiceId"];
  const subscriptionId = meta?.["subscriptionId"];
  const receivableId = meta?.["receivableId"];
  const payableId = meta?.["payableId"];
  const traceable = typeof invoiceId === "string" || typeof receivableId === "string" || typeof payableId === "string";
  return (
    <section
      aria-label={`Evento ${event.id}`}
      className="mt-4 rounded-card border border-line1 bg-bg1 shadow-1 p-5"
    >
      <h3 className="m-0 text-headline text-text1">
        <code className="font-mono text-[0.85em]">{event.action}</code>{" "}
        <span className="text-text2">{event.id}</span>
      </h3>
      <div className="mt-3">
        <MaskedJson data={event.metadataMasked} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {traceable && (
          <Button variant="primary" onClick={() => onTrace(event)} title="Abrir rastro do evento">
            Rastrear charge → fatura → auditoria
          </Button>
        )}
        {typeof invoiceId === "string" && (
          <Link className={LINK_BUTTON_CLASS} href="/cobrancas">
            Abrir cobranças
          </Link>
        )}
        {typeof subscriptionId === "string" && (
          <Link className={LINK_BUTTON_CLASS} href="/assinaturas">
            Abrir assinaturas
          </Link>
        )}
        <Button variant="secondary" onClick={onClose} title="Fechar detalhe do evento">
          Fechar
        </Button>
      </div>
    </section>
  );
}
