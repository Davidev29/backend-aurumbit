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
import type { Page, PayableStatus, PayableView } from "@/lib/types";

const RECURRENCE_LABEL: Record<PayableView["recurrence"], string> = {
  UNICA: "Única",
  MENSAL: "Mensal",
  TRIMESTRAL: "Trimestral",
  ANUAL: "Anual",
};

/**
 * Contas a pagar (Fase 5: fornecedor/categoria/vencimento/estado/recorrência).
 * Pagar exige `finance.manage` + confirmação + motivo (dialog auditado).
 */
export function PayableTable({
  page,
  loading,
  error,
  onRetry,
  onSettled,
  onTrace,
}: {
  page: Page<PayableView> | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSettled: () => void;
  onTrace: (payable: PayableView) => void;
}) {
  const canSettle = useCan("finance.manage");
  const [target, setTarget] = useState<PayableView | null>(null);

  if (loading) {
    return <Skeleton height="12rem" label="Carregando contas a pagar" />;
  }
  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }
  if (!page || page.data.length === 0) {
    return (
      <EmptyState
        title="Nenhuma conta a pagar"
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
        caption="Contas a pagar (paginação por cursor)"
        head={
          <>
            <Th>Fornecedor</Th>
            <Th>Categoria</Th>
            <Th>Vencimento</Th>
            <Th>Estado</Th>
            <Th>Recorrência</Th>
            <Th numeric>Valor</Th>
            <Th>Ações</Th>
          </>
        }
      >
        {page.data.map((p) => {
          const payable = p.status === "PENDENTE" || p.status === "VENCIDO";
          return (
            <tr key={p.id}>
              <Td>{p.supplier}</Td>
              <Td>{p.category}</Td>
              <Td>{formatDateInTZ(p.dueDate)}</Td>
              <Td>
                <FinanceBadge status={p.status as PayableStatus} />
              </Td>
              <Td>{RECURRENCE_LABEL[p.recurrence]}</Td>
              <Td numeric mono>
                {formatBRL(p.amount)}
              </Td>
              <Td>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!payable || !canSettle}
                    title={
                      !canSettle
                        ? "Requer permissão finance.manage"
                        : !payable
                          ? "Conta já liquidada ou cancelada"
                          : "Pagar conta (auditado)"
                    }
                    onClick={() => setTarget(p)}
                  >
                    Pagar
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => onTrace(p)}>
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
          kind="pay"
          id={target.id}
          title={target.supplier}
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
