import { Ban, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { PayableStatus, ReceivableStatus, TransactionKind } from "@/lib/types";

const LABELS: Record<PayableStatus | ReceivableStatus | TransactionKind, string> = {
  PREVISTO: "Previsto",
  PENDENTE: "Pendente",
  RECEBIDO: "Recebido",
  PAGO: "Pago",
  VENCIDO: "Vencido",
  CANCELADO: "Cancelado",
  RECEITA: "Receita",
  DESPESA: "Despesa",
};

/**
 * Badge de estado financeiro (Fase 5: PREVISTO/PENDENTE/RECEBIDO/PAGO +
 * VENCIDO/CANCELADO; RECEITA/DESPESA p/ extrato).
 * DS v1: Badge P0 (soft opaco) + ícone + texto (nunca só cor).
 */
export function FinanceBadge({ status }: { status: PayableStatus | ReceivableStatus | TransactionKind }) {
  const tone =
    status === "PAGO" || status === "RECEBIDO" || status === "RECEITA"
      ? ("ok" as const)
      : status === "VENCIDO" || status === "DESPESA"
        ? ("danger" as const)
        : status === "PREVISTO" || status === "PENDENTE"
          ? ("warn" as const)
          : ("neutral" as const);
  const Icon =
    tone === "ok" ? CircleCheck : tone === "danger" ? TriangleAlert : tone === "warn" ? Info : Ban;
  return (
    <Badge tone={tone}>
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      {LABELS[status]}
    </Badge>
  );
}
