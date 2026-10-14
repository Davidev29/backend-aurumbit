"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatDateTimeInTZ } from "@/lib/format";

export interface StaleBannerProps {
  /** Motivo da desatualização (ex.: `staleReason` do snapshot). */
  message?: string;
  /** `asOf` do snapshot (exibido em pt-BR + America/Sao_Paulo). */
  asOf?: string | null;
  onRetry?: () => void;
}

/**
 * Faixa de dados desatualizados (DS §9).
 * SÓ em snapshots (resumo/projeção/filas). Listas vivas (cobranças/
 * assinaturas/auditoria) não têm snapshot — não exibem este banner.
 */
export function StaleBanner({ message, asOf, onRetry }: StaleBannerProps) {
  return (
    <div className="card" role="status" style={{ borderColor: "var(--warn)", marginBottom: "1rem" }}>
      <p className="m-0 flex items-start gap-2 text-body text-text1">
        <TriangleAlert size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-warn" />
        <span>
          <strong>Dados possivelmente desatualizados.</strong>{" "}
          <span className="muted">{message ?? "A última sincronização não foi concluída."}</span>{" "}
          {asOf && (
            <span className="muted">
              Snapshot de {formatDateTimeInTZ(asOf)} (America/Sao_Paulo).
            </span>
          )}
        </span>
      </p>
      {onRetry && (
        <p className="m-0 mt-2">
          <Button type="button" variant="secondary" onClick={onRetry} title="Atualizar snapshot">
            Atualizar
          </Button>
        </p>
      )}
    </div>
  );
}
