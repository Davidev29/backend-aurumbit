"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TraceabilityDrawer } from "@/components/billing/TraceabilityDrawer";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { ErrorState } from "@/components/feedback/ErrorState";
import { ExportButton } from "@/components/finance/ExportButton";
import { ExpenseDialog } from "@/components/finance/ExpenseDialog";
import { FinancePdfButton } from "@/components/finance/FinancePdfDialog";
import { PayableTable } from "@/components/finance/PayableTable";
import { ProjectionChart } from "@/components/finance/ProjectionChart";
import { QuickFilterChips, matchesQuick, type FinanceQuickFilter } from "@/components/finance/QuickFilter";
import { ReceivableAutoDialog } from "@/components/finance/ReceivableAutoDialog";
import { ReceivableTable } from "@/components/finance/ReceivableTable";
import { TransactionTable } from "@/components/finance/TransactionTable";
import { TimezoneBadge } from "@/components/shell/TimezoneBadge";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/skeleton";
import { Pager } from "@/components/ui/table";
import { RequirePerm, useCan, useMe } from "@/lib/auth/permissions";
import {
  getFinanceSummary,
  getFinanceTrace,
  listPayables,
  listReceivables,
  listTransactions,
} from "@/lib/finance";
import { formatBRL } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { useOrgStore } from "@/stores/org-store";
import type {
  FinanceFilters,
  FinanceSummary,
  Page,
  PayableView,
  ReceivableView,
  TransactionKind,
  TransactionView,
} from "@/lib/types";
import type { FinanceTrace } from "@/lib/finance";

type Tab = "pagar" | "receber" | "transacoes" | "projecoes";

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: "pagar", label: "A pagar", hint: "Despesas: fornecedor, vencimento e baixa" },
  { id: "receber", label: "A receber", hint: "Receitas: cliente, vencimento e baixa" },
  { id: "transacoes", label: "Transações", hint: "Extrato realizado (único mutador de saldo)" },
  { id: "projecoes", label: "Projeções", hint: "Receita × despesa por período" },
];

const PAYABLE_STATUSES = ["", "PREVISTO", "PENDENTE", "PAGO", "VENCIDO", "CANCELADO"] as const;
const RECEIVABLE_STATUSES = ["", "PREVISTO", "PENDENTE", "RECEBIDO", "VENCIDO", "CANCELADO"] as const;

const SELECT_CLASS =
  "w-full min-h-[44px] px-3 rounded-base text-body text-text1 bg-bg2 border border-line2 focus-ring";

/**
 * Financeiro real (Fase 5 — REQUIREMENTS §3, PROJECT §3/§5).
 * Gate duplo: middleware (redirect) + RequirePerm `finance.read` escopado
 * por org (sem → Forbidden). Pagar/baixar/export exigem `finance.manage`.
 * Alertas operacionais saem EXCLUSIVAMENTE por toast; o histórico vive em
 * `/notificacoes` (rota própria da central).
 */
export default function FinanceiroPage() {
  const { me } = useMe();
  const { orgId } = useOrgStore();
  const activeOrg = orgId ?? me?.organizationId ?? null;

  const [tab, setTab] = useState<Tab>("pagar");
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryNonce, setSummaryNonce] = useState(0);
  const [trace, setTrace] = useState<FinanceTrace | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceParams, setTraceParams] = useState<{ receivableId?: string; payableId?: string } | null>(null);
  const canManage = useCan("finance.manage");
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [autoChargeOpen, setAutoChargeOpen] = useState(false);
  const [listKey, setListKey] = useState(0);
  const { notify } = useToast();
  // Snapshot desatualizado NÃO quebra o layout: sai só por toast (uma vez por snapshot).
  const staleNotifiedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFinanceSummary()
      .then((s) => {
        if (!cancelled) {
          setSummary(s);
          setSummaryError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setSummaryError(err instanceof Error ? err.message : "Falha ao carregar KPIs.");
      });
    return () => {
      cancelled = true;
    };
  }, [summaryNonce]);

  useEffect(() => {
    if (!summary?.isStale) return;
    const key = `fin-summary|${summary.asOf}`;
    if (staleNotifiedRef.current === key) return;
    staleNotifiedRef.current = key;
    notify("warn", "Dados possivelmente desatualizados", summary.staleReason ?? "Snapshot desatualizado.");
  }, [summary, notify]);

  function refreshAll() {
    setSummaryNonce((n) => n + 1);
    setListKey((k) => k + 1);
  }

  async function openTrace(params: { receivableId?: string; payableId?: string }) {
    setTrace(null);
    setTraceError(null);
    setTraceLoading(true);
    setTraceParams(params);
    try {
      const t = await getFinanceTrace(params);
      setTrace(t);
    } catch (err) {
      setTraceError(err instanceof Error ? err.message : "Falha ao carregar rastro.");
    } finally {
      setTraceLoading(false);
    }
  }

  const activeTab = TABS.find((t) => t.id === tab);

  return (
    <RequirePerm perm="finance.read" organizationId={activeOrg}>
      <div className="flex flex-col gap-8">
        {/* Cabeçalho */}
        <section aria-labelledby="fin-title" className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="m-0 text-micro font-bold uppercase tracking-wider text-text2">Operação · Gestão financeira</p>
            <h1 id="fin-title" className="m-0 mt-1 text-title-page">
              Financeiro
            </h1>
            <p className="mb-0 mt-2 max-w-2xl text-body text-text2">
              Despesas e receitas com baixa auditada, extrato realizado e projeção. Alertas chegam por toast e ficam
              na central de notificações.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManage && (
              <>
                <Button type="button" variant="secondary" onClick={() => setAutoChargeOpen(true)}>
                  Receita automática
                </Button>
                <Button type="button" variant="primary" onClick={() => setExpenseOpen(true)}>
                  Nova despesa
                </Button>
              </>
            )}
            <TimezoneBadge />
          </div>
        </section>

        {summaryError && !summary && (
          <ErrorState message={summaryError} onRetry={() => setSummaryNonce((n) => n + 1)} />
        )}

        {/* KPIs */}
        <section aria-label="Indicadores financeiros" className="rounded-card border border-line1 bg-bg1 p-5 shadow-1">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Previsto"
              value={summary?.previsto ?? 0}
              kind="currency"
              hint={summaryError ?? "Contas previstas (pagar + receber)"}
            />
            <KpiCard
              label="Pendente"
              value={summary?.pendente ?? 0}
              kind="currency"
              hint="Pendente + vencido"
            />
            <KpiCard
              label="Realizado"
              value={summary?.realizado ?? 0}
              kind="currency"
              hint="Extrato (receitas − despesas)"
            />
            <KpiCard
              label="Inadimplência"
              value={summary?.inadimplente ?? 0}
              kind="currency"
              hint={
                summary
                  ? `${((summary.taxaInadimplencia ?? 0) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do total a receber`
                  : "Recebíveis vencidos"
              }
            />
          </div>
        </section>

        {/* Abas */}
        <section aria-label="Seções do financeiro" className="rounded-card border border-line1 bg-bg1 p-5 shadow-1">
          <div className="flex gap-1 overflow-x-auto border-b border-line1" role="tablist" aria-label="Seções do financeiro">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                title={t.hint}
                onClick={() => setTab(t.id)}
                className={
                  tab === t.id
                    ? "min-h-[44px] shrink-0 px-4 text-body font-semibold text-text1 border-b-2 border-accent bg-transparent cursor-pointer focus-ring"
                    : "min-h-[44px] shrink-0 px-4 text-body font-semibold text-text2 border-b-2 border-transparent bg-transparent cursor-pointer hover:text-text1 focus-ring"
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          {activeTab && <p className="mb-0 mt-3 text-callout text-text2">{activeTab.hint}</p>}

          <div key={listKey} role="tabpanel" aria-label={activeTab?.label} className="mt-6">
            {tab === "pagar" && (
              <PayablesPanel onSettled={refreshAll} onTrace={(p) => openTrace({ payableId: p.id })} />
            )}
            {tab === "receber" && (
              <ReceivablesPanel onSettled={refreshAll} onTrace={(r) => openTrace({ receivableId: r.id })} />
            )}
            {tab === "transacoes" && <TransactionsPanel />}
            {tab === "projecoes" && <ProjectionChart />}
          </div>
        </section>

        {expenseOpen && (
          <ExpenseDialog onClose={() => setExpenseOpen(false)} onDone={refreshAll} />
        )}
        {autoChargeOpen && (
          <ReceivableAutoDialog onClose={() => setAutoChargeOpen(false)} onDone={refreshAll} />
        )}

        {(traceLoading || traceError || trace) && (
          <TracePanel
            trace={trace}
            loading={traceLoading}
            error={traceError}
            onRetry={() => {
              if (traceParams) openTrace(traceParams);
            }}
            onClose={() => {
              setTrace(null);
              setTraceError(null);
            }}
          />
        )}
      </div>
    </RequirePerm>
  );
}

function useFilters() {
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [quick, setQuick] = useState<FinanceQuickFilter>("todas");
  return { status, setStatus, category, setCategory, from, setFrom, to, setTo, quick, setQuick };
}

function toDateFilters(f: { from: string; to: string }): Pick<FinanceFilters, "from" | "to"> {
  return {
    from: f.from ? `${f.from}T00:00:00.000Z` : null,
    to: f.to ? `${f.to}T23:59:59.999Z` : null,
  };
}

function FilterBar({
  statuses,
  f,
  onChange,
  exportScope,
  quickLabelId,
  settledLabel,
}: {
  statuses: readonly string[];
  f: ReturnType<typeof useFilters>;
  onChange: () => void;
  exportScope: "payables" | "receivables" | "transactions";
  quickLabelId: string;
  settledLabel: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p id={quickLabelId} className="m-0 mb-2 text-headline">
          Situação <span className="font-normal text-callout text-text2">— efetivadas: {settledLabel}</span>
        </p>
        <QuickFilterChips
          value={f.quick}
          labelledBy={quickLabelId}
          onChange={(v) => {
            f.setQuick(v);
            onChange();
          }}
        />
      </div>
      <form
        aria-label="Filtros financeiros"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field label="Estado" htmlFor={`fin-status-${exportScope}`}>
          <select
            id={`fin-status-${exportScope}`}
            className={SELECT_CLASS}
            value={f.status}
            onChange={(e) => {
              f.setStatus(e.target.value);
              onChange();
            }}
          >
            {statuses.map((s) => (
              <option key={s || "all"} value={s}>
                {s === "" ? "Todos os estados" : s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Categoria" htmlFor={`fin-cat-${exportScope}`}>
          <Input
            id={`fin-cat-${exportScope}`}
            placeholder="Ex.: Assinatura"
            value={f.category}
            onChange={(e) => {
              f.setCategory(e.target.value);
              onChange();
            }}
          />
        </Field>
        <Field label="De" htmlFor={`fin-from-${exportScope}`}>
          <Input
            id={`fin-from-${exportScope}`}
            type="date"
            value={f.from}
            onChange={(e) => {
              f.setFrom(e.target.value);
              onChange();
            }}
          />
        </Field>
        <Field label="Até" htmlFor={`fin-to-${exportScope}`}>
          <Input
            id={`fin-to-${exportScope}`}
            type="date"
            value={f.to}
            onChange={(e) => {
              f.setTo(e.target.value);
              onChange();
            }}
          />
        </Field>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FinancePdfButton />
          <ExportButton scope={exportScope} />
        </div>
      </form>
    </div>
  );
}

function FinancePager({
  page,
  pageIdx,
  onPrev,
  onNext,
}: {
  page: Page<unknown> | null;
  pageIdx: number;
  onPrev: () => void;
  onNext: (cursor: string) => void;
}) {
  if (!page || page.data.length === 0) return null;
  return (
    <div className="mt-4">
      <Pager
        hasPrev={pageIdx > 0}
        hasNext={!!page.meta.nextCursor}
        onPrev={onPrev}
        onNext={() => {
          if (page.meta.nextCursor) onNext(page.meta.nextCursor);
        }}
      />
    </div>
  );
}

function useCursor() {
  const [history, setHistory] = useState<Array<string | null>>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const cursor = history[pageIdx] ?? null;
  function reset() {
    setHistory([null]);
    setPageIdx(0);
  }
  function prev() {
    setPageIdx((i) => Math.max(0, i - 1));
  }
  function next(c: string) {
    setHistory((h) => [...h.slice(0, pageIdx + 1), c]);
    setPageIdx((i) => i + 1);
  }
  return { cursor, pageIdx, reset, prev, next };
}

function PayablesPanel({ onSettled, onTrace }: { onSettled: () => void; onTrace: (p: PayableView) => void }) {
  const f = useFilters();
  const pg = useCursor();
  const [page, setPage] = useState<Page<PayableView> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Recorte rápido (efetivadas/aguardando/atrasadas) é aplicado no cliente
    // sobre a página — o backend filtra por estado único; sem ele, buscamos
    // todos e recortamos por grupo (mantém paginação do stub + real).
    listPayables(
      {
        status: f.quick !== "todas" ? null : f.status || null,
        category: f.category || null,
        product: null,
        ...toDateFilters(f),
      },
      pg.cursor,
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
  }, [f.status, f.category, f.from, f.to, f.quick, pg.cursor, nonce]);

  const visible = useMemo(() => {
    if (!page) return null;
    if (f.quick === "todas") return page;
    const data = page.data.filter((p) => matchesQuick(p.status, f.quick, "PAGO"));
    return { ...page, data };
  }, [page, f.quick]);

  return (
    <div className="flex flex-col gap-5">
      <FilterBar
        statuses={PAYABLE_STATUSES}
        f={f}
        onChange={pg.reset}
        exportScope="payables"
        quickLabelId="fin-quick-pagar"
        settledLabel="PAGO"
      />
      <PayableTable
        page={visible}
        loading={loading}
        error={error}
        onRetry={() => setNonce((n) => n + 1)}
        onSettled={() => {
          setNonce((n) => n + 1);
          onSettled();
        }}
        onTrace={onTrace}
      />
      <FinancePager page={visible} pageIdx={pg.pageIdx} onPrev={pg.prev} onNext={pg.next} />
    </div>
  );
}

function ReceivablesPanel({
  onSettled,
  onTrace,
}: {
  onSettled: () => void;
  onTrace: (r: ReceivableView) => void;
}) {
  const f = useFilters();
  const pg = useCursor();
  const [page, setPage] = useState<Page<ReceivableView> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listReceivables(
      {
        status: f.quick !== "todas" ? null : f.status || null,
        category: f.category || null,
        product: null,
        ...toDateFilters(f),
      },
      pg.cursor,
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
  }, [f.status, f.category, f.from, f.to, f.quick, pg.cursor, nonce]);

  const visible = useMemo(() => {
    if (!page) return null;
    if (f.quick === "todas") return page;
    const data = page.data.filter((r) => matchesQuick(r.status, f.quick, "RECEBIDO"));
    return { ...page, data };
  }, [page, f.quick]);

  return (
    <div className="flex flex-col gap-5">
      <FilterBar
        statuses={RECEIVABLE_STATUSES}
        f={f}
        onChange={pg.reset}
        exportScope="receivables"
        quickLabelId="fin-quick-receber"
        settledLabel="RECEBIDO"
      />
      <ReceivableTable
        page={visible}
        loading={loading}
        error={error}
        onRetry={() => setNonce((n) => n + 1)}
        onSettled={() => {
          setNonce((n) => n + 1);
          onSettled();
        }}
        onTrace={onTrace}
      />
      <FinancePager page={visible} pageIdx={pg.pageIdx} onPrev={pg.prev} onNext={pg.next} />
    </div>
  );
}

function TransactionsPanel() {
  const f = useFilters();
  const pg = useCursor();
  const [kind, setKind] = useState<"" | TransactionKind>("");
  const [page, setPage] = useState<Page<TransactionView> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listTransactions(
      {
        kind: kind || null,
        status: null,
        category: f.category || null,
        product: null,
        ...toDateFilters(f),
      },
      pg.cursor,
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
  }, [kind, f.category, f.from, f.to, pg.cursor, nonce]);

  return (
    <div className="flex flex-col gap-5">
      <form
        aria-label="Filtros do extrato"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field label="Tipo" htmlFor="txn-kind">
          <select
            id="txn-kind"
            className={SELECT_CLASS}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as "" | TransactionKind);
              pg.reset();
            }}
          >
            <option value="">Receitas + despesas</option>
            <option value="RECEITA">Receita</option>
            <option value="DESPESA">Despesa</option>
          </select>
        </Field>
        <Field label="Categoria" htmlFor="fin-cat-transactions">
          <Input
            id="fin-cat-transactions"
            placeholder="Ex.: Assinatura"
            value={f.category}
            onChange={(e) => {
              f.setCategory(e.target.value);
              pg.reset();
            }}
          />
        </Field>
        <Field label="De" htmlFor="fin-from-transactions">
          <Input
            id="fin-from-transactions"
            type="date"
            value={f.from}
            onChange={(e) => {
              f.setFrom(e.target.value);
              pg.reset();
            }}
          />
        </Field>
        <Field label="Até" htmlFor="fin-to-transactions">
          <Input
            id="fin-to-transactions"
            type="date"
            value={f.to}
            onChange={(e) => {
              f.setTo(e.target.value);
              pg.reset();
            }}
          />
        </Field>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FinancePdfButton />
          <ExportButton scope="transactions" />
        </div>
      </form>
      <TransactionTable page={page} loading={loading} error={error} onRetry={() => setNonce((n) => n + 1)} />
      <FinancePager page={page} pageIdx={pg.pageIdx} onPrev={pg.prev} onNext={pg.next} />
      {page && page.data.length > 0 && (
        <p className="m-0 text-callout text-text2">
          Saldo do período exibido:{" "}
          <span className="font-mono tnum">
            {formatBRL(page.data.reduce((s, t) => s + (t.kind === "RECEITA" ? t.amount : -t.amount), 0))}
          </span>
        </p>
      )}
    </div>
  );
}

function TracePanel({
  trace,
  loading,
  error,
  onRetry,
  onClose,
}: {
  trace: FinanceTrace | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-card bg-bg1 border border-line1 shadow-1 p-5" aria-label="Carregando rastro">
        <Skeleton height="8rem" label="Carregando rastro" />
      </div>
    );
  }
  if (error || !trace) {
    return (
      <div className="rounded-card bg-bg1 border border-line1 shadow-1 p-5">
        <ErrorState message={error ?? "Rastro não encontrado."} onRetry={onRetry} />
        <Button type="button" variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </div>
    );
  }
  return (
    <TraceabilityDrawer
      invoice={trace.invoice}
      payments={trace.payments}
      receivable={trace.receivable}
      payable={trace.payable}
      transaction={trace.transactions[0] ?? null}
      auditEvents={trace.audit}
      onClose={onClose}
    />
  );
}
