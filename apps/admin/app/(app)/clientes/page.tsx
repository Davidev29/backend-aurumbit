"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Pager } from "@/components/ui/table";
import { SkeletonTable } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { useCan } from "@/lib/auth/permissions";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { Page } from "@/lib/types";
import {
  listAllCustomerEmails,
  listCustomerProducts,
  listCustomers,
  setCustomerBlocked,
  type CustomerRow,
  type CustomerStatusFilter,
} from "@/components/clientes/customer-data";
import { CustomerFilters } from "@/components/clientes/CustomerFilters";
import { CustomerTable } from "@/components/clientes/CustomerTable";
import { CustomerDetailModal } from "@/components/clientes/CustomerDetailModal";
import { BlockCustomerDialog } from "@/components/clientes/BlockCustomerDialog";
import { PreRegisterDialog, type PreRegistered } from "@/components/clientes/PreRegisterDialog";

const PAGE_LIMIT = 6;

/**
 * Clientes — listagem gerenciável com filtros (nome/e-mail, produto, status)
 * e paginação por cursor (DS §9: Anterior/Próxima, nunca numerada).
 * Detalhe em modal `xl`; gestão inline (bloquear/liberar) e completa (modal).
 * TODO(backend pronto): trocar `listCustomers` por `apiGet("/v1/customers…")`
 * + `POST /v1/customers` p/ o pré-cadastro (hoje em sessão).
 */
export default function ClientesPage() {
  const canCreate = useCan("customer.read");
  const canToggleBlock = useCan("license.adjust");
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const [product, setProduct] = useState("");
  const [status, setStatus] = useState<CustomerStatusFilter>("all");
  const [history, setHistory] = useState<Array<string | null>>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const [page, setPage] = useState<Page<CustomerRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [rev, setRev] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blockTarget, setBlockTarget] = useState<CustomerRow | null>(null);
  const [blockNotice, setBlockNotice] = useState<string | null>(null);
  const [preOpen, setPreOpen] = useState(false);
  const [fresh, setFresh] = useState<PreRegistered | null>(null);
  const [copied, setCopied] = useState(false);

  const cursor = history[pageIdx] ?? null;

  const products = useMemo(() => listCustomerProducts(), [rev]);
  const takenEmails = useMemo(() => listAllCustomerEmails(), [rev, page, preOpen]);

  const hasActiveFilters = query !== "" || product !== "" || status !== "all";

  function resetPaging() {
    setHistory([null]);
    setPageIdx(0);
  }

  function clearFilters() {
    setQuery("");
    setProduct("");
    setStatus("all");
    resetPaging();
  }

  function focusTrigger(id: string) {
    requestAnimationFrame(() => {
      document.getElementById(`cliente-${id}`)?.focus();
    });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Camada tolerante a sync/async: `Promise.resolve` aceita ambos os moldes
    // (stub síncrono hoje, `apiGet` assíncrono no backend real).
    Promise.resolve()
      .then(() =>
        listCustomers({
          q: debounced,
          product: product || null,
          status,
          cursor,
          limit: PAGE_LIMIT,
        }),
      )
      .then((p) => {
        if (!cancelled) setPage(p);
      })
      .catch((err) => {
        if (!cancelled) {
          setPage(null);
          setError(err instanceof Error ? err.message : "Falha ao carregar clientes.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, product, status, cursor, nonce, rev]);

  const rows = page?.data ?? [];

  function openCustomer(id: string) {
    setSelectedId(id);
  }

  function closeCustomer() {
    const id = selectedId;
    setSelectedId(null);
    // Ações internas do modal (bloqueio) persistem em sessão — relê a lista.
    setRev((r) => r + 1);
    // Retorno de foco ao gatilho (DS §6: foco síncrono, nunca pós-animação).
    if (id) focusTrigger(id);
  }

  function closeBlockDialog() {
    const id = blockTarget?.id;
    setBlockTarget(null);
    if (id) focusTrigger(id);
  }

  async function copySetupLink() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.setupLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      /* clipboard indisponível — link segue selecionável */
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-title-page text-text1">Clientes</h1>
          <p className="m-0 mt-1 text-callout text-text2">
            Busque por nome, filtre por produto e status, gerencie acesso sem sair da lista.
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={() => setPreOpen(true)}
          disabled={!canCreate}
          title={canCreate ? "Pré-cadastrar cliente (conta e/ou produto)" : "Requer permissão de leitura de clientes"}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          Pré-cadastrar cliente
        </Button>
      </div>

      {fresh && (
        <div className="mb-4 rounded-card border border-line1 bg-bg1 shadow-1 p-4" role="status">
          <p className="m-0 text-body text-text1">
            <Badge tone="ok" state="Conta criada">Conta criada</Badge>{" "}
            {fresh.customer.name}
            {fresh.product ? ` · produto ${fresh.product}` : " · somente conta"} · trilha{" "}
            <span className="font-mono tnum text-[0.85em]">{fresh.auditId}</span>
          </p>
          <p className="mb-2 mt-2 text-callout text-text2">
            Link de definição de senha (demonstração — expira; o backend envia por e-mail):
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-base border border-line1 bg-bg2 p-2 font-mono tnum text-callout text-text1">
              {fresh.setupLink}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={copySetupLink}
              title="Copiar link de definição de senha"
              aria-live="polite"
            >
              {copied ? (
                <Check size={16} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
              )}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </div>
      )}

      {blockNotice && (
        <div className="mb-4 rounded-card border border-line1 bg-bg1 shadow-1 p-4" role="status">
          <p className="m-0 text-body text-text1">{blockNotice}</p>
        </div>
      )}

      <CustomerFilters
        query={query}
        onQueryChange={(v) => {
          setQuery(v);
          resetPaging();
        }}
        product={product}
        onProductChange={(v) => {
          setProduct(v);
          resetPaging();
        }}
        status={status}
        onStatusChange={(v) => {
          setStatus(v);
          resetPaging();
        }}
        products={products}
        onClear={clearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {loading ? (
        <SkeletonTable rows={PAGE_LIMIT} label="Carregando clientes" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : !page || rows.length === 0 ? (
        <EmptyState
          title="Nenhum cliente encontrado"
          message={
            hasActiveFilters
              ? "Ajuste a busca, o produto ou o status — ou limpe os filtros."
              : "Ajuste a busca ou pré-cadastre um novo cliente."
          }
          action={
            hasActiveFilters ? (
              <Button type="button" variant="secondary" onClick={clearFilters}>
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="mb-2 text-callout text-text2" aria-live="polite">
            Exibindo {rows.length} {rows.length === 1 ? "cliente" : "clientes"} nesta página
            {product !== "" && <> · produto {product}</>}
            {status !== "all" && <> · {status === "active" ? "ativos" : "bloqueados"}</>}.
          </p>
          <CustomerTable
            rows={rows}
            selectedId={selectedId}
            onOpen={openCustomer}
            onToggleBlock={(row) => setBlockTarget(row)}
            canToggleBlock={canToggleBlock}
          />
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

      {selectedId && <CustomerDetailModal customerId={selectedId} onClose={closeCustomer} />}

      {blockTarget && (
        <BlockCustomerDialog
          customerId={blockTarget.id}
          customerName={blockTarget.name}
          blocked={blockTarget.status === "blocked"}
          onClose={closeBlockDialog}
          onDone={(next) => {
            // `BlockCustomerDialog` já persistiu em sessão; aqui só refletimos.
            setCustomerBlocked(blockTarget.id, next);
            setRev((r) => r + 1);
            setBlockNotice(
              next
                ? `Acesso de ${blockTarget.name} bloqueado (stub em sessão — TODO backend).`
                : `Acesso de ${blockTarget.name} liberado (stub em sessão — TODO backend).`,
            );
            closeBlockDialog();
          }}
        />
      )}

      {preOpen && (
        <PreRegisterDialog
          takenEmails={takenEmails}
          onClose={() => setPreOpen(false)}
          onDone={(entry) => {
            // `PreRegisterDialog` já registrou em sessão; volta à 1ª página.
            setFresh(entry);
            setCopied(false);
            setBlockNotice(null);
            setRev((r) => r + 1);
            resetPaging();
          }}
        />
      )}
    </div>
  );
}
