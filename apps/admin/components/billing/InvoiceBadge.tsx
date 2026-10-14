import { Ban, CircleCheck, FileText, Info, RotateCcw, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { InvoiceStatus } from "@/lib/types";

const LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Rascunho",
  PENDING: "Pendente",
  PAID: "Paga",
  OVERDUE: "Vencida",
  REFUNDED: "Estornada",
  CANCELLED: "Cancelada",
};

const TONES: Record<InvoiceStatus, "warn" | "ok" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  PENDING: "warn",
  PAID: "ok",
  OVERDUE: "danger",
  REFUNDED: "info",
  CANCELLED: "neutral",
};

const ICONS: Record<InvoiceStatus, typeof Info> = {
  DRAFT: FileText,
  PENDING: Info,
  PAID: CircleCheck,
  OVERDUE: TriangleAlert,
  REFUNDED: RotateCcw,
  CANCELLED: Ban,
};

/** Badge de estado da fatura (PAID/OVERDUE/REFUNDED + demais — Fase 4). */
export function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  const Icon = ICONS[status];
  return (
    <span aria-label={`Estado: ${LABELS[status]}`}>
      <Badge tone={TONES[status]}>
        <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
        {LABELS[status]}
      </Badge>
    </span>
  );
}
