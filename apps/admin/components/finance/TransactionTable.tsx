"use client";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, Td, Th } from "@/components/ui/table";
import { FinanceBadge } from "./FinanceBadge";
import { formatBRL, formatDateTimeInTZ } from "@/lib/format";
import type { Page, TransactionView } from "@/lib/types";

/**
 * Extrato realizado (Fase 5 — `Transaction` é o único mutador de saldo,
 * REQUIREMENTS §3). Somente leitura: lançamentos nascem de pagar/baixar.
 */
export function TransactionTable({
  page,
  loading,
  error,
  onRetry,
}: {
  page: Page<TransactionView> | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return <Skeleton height="12rem" label="Carregando extrato" />;
  }
  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }
  if (!page || page.data.length === 0) {
    return (
      <EmptyState
        title="Nenhum lançamento"
        message="Ajuste os filtros de tipo, categoria ou período."
        action={
          <Button type="button" variant="secondary" onClick={onRetry}>
            Recarregar
          </Button>
        }
      />
    );
  }

  return (
    <Table
      caption="Extrato realizado (mais recentes primeiro)"
      head={
        <>
          <Th>Lançamento</Th>
          <Th>Descrição</Th>
          <Th>Categoria</Th>
          <Th>Tipo</Th>
          <Th>Liquidado em</Th>
          <Th numeric>Valor</Th>
        </>
      }
    >
      {page.data.map((t) => (
        <tr key={t.id}>
          <Td mono>{t.id}</Td>
          <Td>{t.description}</Td>
          <Td>{t.category}</Td>
          <Td>
            <FinanceBadge status={t.kind} />
          </Td>
          <Td>{formatDateTimeInTZ(t.settledAt)}</Td>
          <Td numeric mono>
            {formatBRL(t.kind === "DESPESA" ? -t.amount : t.amount)}
          </Td>
        </tr>
      ))}
    </Table>
  );
}
