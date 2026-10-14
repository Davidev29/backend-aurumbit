"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { useCan } from "@/lib/auth/permissions";
import { exportFinanceCsv } from "@/lib/finance";
import { useToast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import type { FinanceExportScope } from "@/lib/types";

const SCOPE_LABEL: Record<FinanceExportScope, string> = {
  payables: "pagar",
  receivables: "receber",
  transactions: "transações",
};

/**
 * Export CSV do financeiro (Fase 5 + Fase 6).
 * Guardas (Fase 6 — todos os exports):
 * - exige `finance.manage` (só admin; botão desabilitado sem ela);
 * - confirmação explícita em 2 passos (checkbox + confirmar);
 * - auditado: o backend registra `finance.export` (stub BFF gera a partir de
 *   `lib/mocks.ts` até o Nest real assumir — TODO abaixo).
 * TODO(backend pronto): o Nest gera o CSV com filtros aplicados + audit
 * `finance.export`; hoje o BFF retorna stub a partir de `lib/mocks.ts`.
 */
export function ExportButton({ scope }: { scope: FinanceExportScope }) {
  const canExport = useCan("finance.manage");
  const { notify } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkboxId = `export-fin-${scope}-confirm`;

  function cancel() {
    setConfirming(false);
    setAcknowledged(false);
  }

  async function handleExport() {
    if (!canExport || pending || !acknowledged) return;
    setPending(true);
    setError(null);
    try {
      const { filename, csv } = await exportFinanceCsv(scope);
      const blob = new Blob([`﻿${csv}`], { type: "text/csv; charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("success", "CSV exportado", `finance-${scope}.csv gerado com sucesso.`);
      cancel();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao exportar.";
      setError(msg);
      notify("error", "Falha na exportação CSV", msg);
    } finally {
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <span className="inline-flex gap-2 items-center">
        <Button
          type="button"
          variant="secondary"
          disabled={!canExport}
          title={canExport ? `Exportar CSV de ${SCOPE_LABEL[scope]} (auditado)` : "Requer permissão finance.manage"}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          <Download size={20} strokeWidth={1.75} aria-hidden="true" />
          Exportar CSV
        </Button>
        {error && (
          <span className="m-0 text-callout text-danger" role="alert">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <span
      className="inline-flex gap-2 items-center flex-wrap"
      role="group"
      aria-label={`Confirmar exportação de ${SCOPE_LABEL[scope]}`}
    >
      <label htmlFor={checkboxId} className="inline-flex gap-2 items-center text-callout text-text2">
        <input
          id={checkboxId}
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="w-5 h-5 shrink-0"
          style={{ accentColor: "var(--accent)" }}
        />
        Confirmo a exportação (auditada como finance.export)
      </label>
      <Button
        type="button"
        variant="primary"
        disabled={!acknowledged || pending}
        title={!acknowledged ? "Confirme a exportação para continuar" : "Confirmar exportação"}
        onClick={handleExport}
      >
        {pending ? "Exportando…" : "Confirmar exportação"}
      </Button>
      <Button type="button" variant="secondary" disabled={pending} onClick={cancel}>
        Cancelar
      </Button>
      {error && (
        <span className="m-0 text-callout text-danger" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
