import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/EmptyState";
import { formatDateInTZ } from "@/lib/format";
import type { LicenseView } from "@/lib/types";
import { GraceBadge, aurumGraceHeader } from "./GraceBadge";
import { LicenseActions } from "./LicenseActions";
import { LicenseKeyMasked } from "./LicenseKeyMasked";

/**
 * Tab licenças do cliente (Fase 3): chave mascarada + reveal auditado,
 * validade/status, máquinas usadas-permitidas, origem e badge de graça.
 * Licenças degradadas respondem com `X-Aurum-Grace: true` no check-access.
 */
export function LicenseTable({ licenses }: { licenses: LicenseView[] }) {
  if (licenses.length === 0) {
    return <EmptyState title="Sem licenças" message="Este cliente ainda não possui licenças." />;
  }
  const hasGrace = licenses.some((l) => l.status === "grace" || l.degraded === true);
  return (
    <div>
      <p className="text-callout text-text2">
        Chaves sempre mascaradas (PROJECT §2). Revelação exige{" "}
        <code className="font-mono tnum text-[0.85em]">license.read</code> + MFA, rate-limit 10/h,
        auditada (<code className="font-mono tnum text-[0.85em]">POST /v1/licenses/:id/reveal</code>
        ).
        {hasGrace && (
          <>
            {" "}
            Há licenças em graça degradada (
            <code className="font-mono tnum text-[0.85em]">X-Aurum-Grace: true</code>) — banner, sem
            ações destrutivas.
          </>
        )}
      </p>
      <Table
        caption="Licenças"
        head={
          <>
            <Th>Chave</Th>
            <Th>Status</Th>
            <Th>Validade</Th>
            <Th numeric>Máquinas</Th>
            <Th>Origem</Th>
            <Th>Ações</Th>
          </>
        }
      >
        {licenses.map((l) => (
          <tr key={l.id}>
            <Td>
              <LicenseKeyMasked licenseId={l.id} keyMasked={l.keyMasked} />
            </Td>
            <Td>
              <GraceBadge status={l.status} graceUntil={l.graceUntil} degraded={l.degraded} />
              {(l.status === "grace" || l.degraded === true) && (
                <span className="block font-mono tnum text-[0.85em] text-text2">
                  X-Aurum-Grace: {aurumGraceHeader(l.degraded)}
                </span>
              )}
            </Td>
            <Td>
              expira em {formatDateInTZ(l.expiresAt)}
              {l.graceUntil && (
                <span className="block text-callout text-text2">
                  graça até {formatDateInTZ(l.graceUntil)}
                </span>
              )}
            </Td>
            <Td numeric>
              <span title={`${l.machinesUsed} de ${l.machinesAllowed} máquinas em uso`}>
                {l.machinesUsed}/{l.machinesAllowed}
              </span>
            </Td>
            <Td>
              <Badge tone="neutral">{l.origin}</Badge>
            </Td>
            <Td>
              <LicenseActions license={l} />
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
