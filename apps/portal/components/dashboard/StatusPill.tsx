import { Badge } from "@/components/ui";
import type { CustomerInvoiceView, CustomerLicenseView } from "@/types";

/**
 * Pills de estado com rótulos fixos (não alterar textos — contrato visual).
 */
export function LicenseStatusPill({ status }: { status: CustomerLicenseView["status"] }) {
  switch (status) {
    case "active":
      return (
        <Badge variant="success" size="sm" dot>
          Ativa
        </Badge>
      );
    case "grace":
      return (
        <Badge variant="info" size="sm" dot>
          Tolerância
        </Badge>
      );
    case "suspended":
      return (
        <Badge variant="danger" size="sm" dot>
          Suspensa
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="neutral" size="sm" dot>
          Expirada
        </Badge>
      );
    case "revoked":
      return (
        <Badge variant="danger" size="sm" dot>
          Revogada
        </Badge>
      );
    default:
      return (
        <Badge variant="neutral" size="sm" dot>
          {status}
        </Badge>
      );
  }
}

export function InvoiceStatusPill({ status }: { status: CustomerInvoiceView["status"] }) {
  switch (status) {
    case "PAID":
      return (
        <Badge variant="success" size="sm">
          Paga
        </Badge>
      );
    case "PENDING":
      return (
        <Badge variant="info" size="sm">
          Pendente
        </Badge>
      );
    case "OVERDUE":
      return (
        <Badge variant="danger" size="sm">
          Vencida
        </Badge>
      );
    case "REFUNDED":
      return (
        <Badge variant="neutral" size="sm">
          Estornada
        </Badge>
      );
    case "CANCELLED":
      return (
        <Badge variant="neutral" size="sm">
          Cancelada
        </Badge>
      );
    default:
      return (
        <Badge variant="neutral" size="sm">
          {status}
        </Badge>
      );
  }
}
