"use client";

import { useEffect, useState } from "react";
import { Ban, CircleCheck, CircleX, FileText, Info, Pause, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Pager, Table, Td, Th } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { BillingExportButton } from "@/components/billing/BillingExportButton";
import { CancelSubscriptionDialog } from "@/components/billing/CancelSubscriptionDialog";
import { RequirePerm, useCan } from "@/lib/auth/permissions";
import { listSubscriptions } from "@/lib/billing";
import { formatBRL, formatDateInTZ } from "@/lib/format";
import type { Page, SubscriptionStatus, SubscriptionView } from "@/lib/types";

const STATUS_OPTIONS: Array<{ value: "" | SubscriptionStatus; label: string }> = [
  { value: "", label: "Todos os estados" },
  { value: "DRAFT", label: "Rascunho" },
  { value: "ACTIVE", label: "Ativa" },
  { value: "PAST_DUE", label: "Inadimplente" },
  { value: "SUSPENDED", label: "Suspensa" },
  { value: "TRIAL", label: "Trial" },
  { value: "CANCELLED", label: "Cancelada" },
  { value: "EXPIRED", label: "Expirada" },
];

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativa",
  PAST_DUE: "Inadimplente",
  SUSPENDED: "Suspensa",
  TRIAL: "Trial",
  CANCELLED: "Cancelada",
  EXPIRED: "Expirada",
};

const STATUS_TONE: Record<SubscriptionStatus, "ok" | "danger" | "info" | "neutral" | "warn"> = {
  DRAFT: "neutral",
  ACTIVE: "ok",
  PAST_DUE: "danger",
  SUSPENDED: "warn",
  TRIAL: "info",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};

const STATUS_ICON: Record<SubscriptionStatus, typeof Info> = {
  DRAFT: FileText,
  ACTIVE: CircleCheck,
  PAST_DUE: TriangleAlert,
  SUSPENDED: Pause,
  TRIAL: Info,
  CANCELLED: Ban,
  EXPIRED: CircleX,
};

const SELECT_CLASS =
  "w-full min-h-[44px] px-3 rounded-base text-body text-text1 bg-bg2 border border-line2 focus-ring";

/**
 * Assinaturas (Fase 4 — REQUIREMENTS §3).
 * Gate: `billing.read` (manager+). Cancelamento exige `billing.manage` +
 * confirmação + motivo. `nextDue` = próxima cobrança.
 */
export default function AssinaturasPage() {
  const canCancel = useCan("billing.manage");
  const [status, setStatus] = useState<"" | SubscriptionStatus>("");
  const [history, setHistory] = useState<Array<string | null>>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const [page, setPage] = useState<Page<SubscriptionView> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [cancelTarget, setCancelTarget] = useState<SubscriptionView | null>(null);

  const cursor = history[pageIdx] ?? null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listSubscriptions(status || null, cursor)
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
  }, [status, cursor, nonce]);

  return (
    <RequirePerm perm="billing.read">
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="m-0 text-title-page text-text1">Assinaturas</h1>
          <BillingExportButton scope="subscriptions" />
        </div>
        <div className="max-w-[20rem]">
          <Field label="Estado" htmlFor="sub-status">
            <select
              id="sub-status"
              className={SELECT_CLASS}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as "" | SubscriptionStatus);
                setHistory([null]);
                setPageIdx(0);
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

        {loading ? (
          <Skeleton height="12rem" label="Carregando assinaturas" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />
        ) : !page || page.data.length === 0 ? (
          <EmptyState
            title="Nenhuma assinatura encontrada"
            message="Ajuste o filtro de estado."
            action={
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setStatus("");
                  setHistory([null]);
                  setPageIdx(0);
                }}
              >
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <>
            <Table
              caption="Assinaturas (paginação por cursor)"
              head={
                <>
                  <Th>Assinatura</Th>
                  <Th>Cliente</Th>
                  <Th>Plano</Th>
                  <Th>Estado</Th>
                  <Th>Próx. cobrança</Th>
                  <Th numeric>Valor</Th>
                  <Th>Ações</Th>
                </>
              }
            >
              {page.data.map((s) => {
                const cancellable = s.status === "ACTIVE" || s.status === "PAST_DUE" || s.status === "TRIAL";
                const StatusIcon = STATUS_ICON[s.status];
                return (
                  <tr key={s.id}>
                    <Td mono>{s.id}</Td>
                    <Td>{s.customerName}</Td>
                    <Td>{s.planName}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[s.status]}>
                        <StatusIcon size={14} strokeWidth={1.75} aria-hidden="true" />
                        {STATUS_LABEL[s.status]}
                      </Badge>
                    </Td>
                    <Td>{formatDateInTZ(s.nextDue)}</Td>
                    <Td numeric>{formatBRL(s.amount)}</Td>
                    <Td>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={!cancellable || !canCancel}
                        title={
                          !canCancel
                            ? "Requer permissão billing.manage"
                            : !cancellable
                              ? "Assinatura já encerrada"
                              : "Cancelar assinatura (auditado)"
                        }
                        onClick={() => setCancelTarget(s)}
                      >
                        Cancelar
                      </Button>
                    </Td>
                  </tr>
                );
              })}
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

        {cancelTarget && (
          <CancelSubscriptionDialog
            subscriptionId={cancelTarget.id}
            planName={cancelTarget.planName}
            onClose={() => setCancelTarget(null)}
            onDone={() => {
              setCancelTarget(null);
              setNonce((n) => n + 1);
            }}
          />
        )}
      </div>
    </RequirePerm>
  );
}
