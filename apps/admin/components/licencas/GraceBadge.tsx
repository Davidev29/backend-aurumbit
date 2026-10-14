import { Ban, CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatDateInTZ } from "@/lib/format";
import type { LicenseStatus } from "@/lib/types";

const STATUS_LABEL: Record<LicenseStatus, string> = {
  active: "Ativa",
  grace: "Graça (degradado)",
  suspended: "Suspensa",
  expired: "Expirada",
  revoked: "Revogada",
};

const STATUS_TONE: Record<LicenseStatus, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  active: "ok",
  grace: "warn",
  suspended: "danger",
  expired: "neutral",
  revoked: "danger",
};

const STATUS_ICON: Record<LicenseStatus, typeof CircleCheck> = {
  active: CircleCheck,
  grace: TriangleAlert,
  suspended: Ban,
  expired: Info,
  revoked: CircleX,
};

/**
 * Badge de graça degradada (PROJECT §1: `lic_exp < now <= grace_until` → ALLOW
 * degradado). O backend sinaliza com `degraded:true` + header `X-Aurum-Grace`.
 */
export function GraceBadge({
  status,
  graceUntil,
  degraded,
}: {
  status: LicenseStatus;
  graceUntil?: string;
  degraded?: boolean;
}) {
  const isGrace = status === "grace" || degraded === true;
  const effective: LicenseStatus = isGrace ? "grace" : status;
  const Icon = STATUS_ICON[effective];
  return (
    <span
      title={
        isGrace
          ? "Licença em tolerância de 3 dias (PROJECT §1). Resposta do check-access inclui X-Aurum-Grace: true — banner degradado, sem ações destrutivas."
          : `Estado: ${STATUS_LABEL[effective]}`
      }
    >
      <Badge tone={STATUS_TONE[effective]}>
        <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
        {isGrace && graceUntil
          ? `Degradado · graça até ${formatDateInTZ(graceUntil)}`
          : STATUS_LABEL[effective]}
      </Badge>
    </span>
  );
}

/** Valor esperado do header `X-Aurum-Grace` p/ a licença (documentação/teste). */
export function aurumGraceHeader(degraded?: boolean): "true" | "false" {
  return degraded === true ? "true" : "false";
}
