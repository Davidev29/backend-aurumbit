"use client";

import { useState } from "react";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, Td, Th } from "@/components/ui/table";
import { useCan } from "@/lib/auth/permissions";
import { FinanceBadge } from "./FinanceBadge";
import { SettleDialog } from "./SettleDialog";
import { formatBRL, formatDateInTZ } from "@/lib/format";
import type { Page, ReceivableStatus, ReceivableView } from "@/lib/types";

const RECURRENCE_LABEL: Record<ReceivableView["recurrence"], string> = {
  UNICA: "Única",
  MENSAL: "Mensal",
  TRIMESTRAL: "Trimestral",
  ANUAL: "Anual",
};

/**
 * Contas a receber (Fase 5: cliente/categoria/vencimento/estado/recorrência).
 * Baixar exige `finance.manage` + confirmação + motivo (dialog auditado).
 */
export function ReceivableTable({
  page,
  loading,
  error,
  onRetry,
  onSettled,
  onTrace,
}: {
  page: Page<ReceivableView> | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSettled: () => void;
  onTrace: (receivable: ReceivableView) => void;
}) {
  const canSettle = useCan("finance.manage");
  const [target, setTarget] = useState<ReceivableView | null>(null);

  if (loading) {
    return <Skeleton height="12rem" label="Carregando contas a receber" />;
  }
  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }
  if (!page || page.data.length === 0) {
    return (
      <EmptyState
        title="Nenhuma conta a receber"
        message="Ajuste os filtros de estado, categoria ou vencimento."
        action={
          <Button type="button" variant="secondary" onClick={onRetry}>
            Recarregar
          </Button>
        }
      />
    );
  }

  return (
    <>
      <Table
        caption="Contas a receber (paginação por cursor)"
        head={
          <>
            <Th>Cliente</Th>
            <Th>Categoria</Th>
            <Th>Vencimento</Th>
            <Th>Estado</Th>
            <Th>Recorrência</Th>
            <Th numeric>Valor</Th>
            <Th>Ações</Th>
          </>
        }
      >
        {page.data.map((r) => {
          const receivable = r.status === "PENDENTE" || r.status === "VENCIDO";
          const priceNote = (r as ReceivableView & { priceNote?: string }).priceNote ?? null;
          return (
            <tr key={r.id}>
              <Td>{r.customerName}</Td>
              <Td>{r.category}</Td>
              <Td>{formatDateInTZ(r.dueDate)}</Td>
              <Td>
                <FinanceBadge status={r.status as ReceivableStatus} />
              </Td>
              <Td>{RECURRENCE_LABEL[r.recurrence]}</Td>
              <Td numeric mono>
                {formatBRL(r.amount)}
                {priceNote && (
                  <span className="mt-1 block whitespace-normal font-sans text-callout text-text2">
                    {priceNote}
                  </span>
                )}
              </Td>
              <Td>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!receivable || !canSettle}
                    title={
                      !canSettle
                        ? "Requer permissão finance.manage"
                        : !receivable
                          ? "Conta já baixada ou cancelada"
                          : "Baixar recebimento (auditado)"
                    }
                    onClick={() => setTarget(r)}
                  >
                    Baixar
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => onTrace(r)}>
                    Rastro
                  </Button>
                </div>
              </Td>
            </tr>
          );
        })}
      </Table>
      {target && (
        <SettleDialog
          kind="receive"
          id={target.id}
          title={target.customerName}
          amount={target.amount}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null);
            onSettled();
          }}
        />
      )}
    </>
  );
}
