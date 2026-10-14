"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useCan } from "@/lib/auth/permissions";
import { exportBillingCsv, type BillingExportScope } from "@/lib/billing";

const SCOPE_LABEL: Record<BillingExportScope, string> = {
  invoices: "cobranças",
  subscriptions: "assinaturas",
  audit: "auditoria",
};

/**
 * Export CSV do billing (Fase 6).
 * Guardas (iguais ao financeiro): exige `billing.manage` (só admin) +
 * confirmação explícita em 2 passos + auditado (`billing.export` no backend;
 * stub BFF gera a partir de `lib/mocks.ts` até o Nest real assumir).
 */
export function BillingExportButton({ scope }: { scope: BillingExportScope }) {
  const canExport = useCan("billing.manage");
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkboxId = `export-billing-${scope}-confirm`;

  function cancel() {
    setConfirming(false);
    setAcknowledged(false);
  }

  async function handleExport() {
    if (!canExport || pending || !acknowledged) return;
    setPending(true);
    setError(null);
    try {
      const { filename, csv } = await exportBillingCsv(scope);
      const blob = new Blob([`﻿${csv}`], { type: "text/csv; charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao exportar.");
    } finally {
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={!canExport}
          title={canExport ? `Exportar CSV de ${SCOPE_LABEL[scope]} (auditado)` : "Requer permissão billing.manage"}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          Exportar CSV
        </Button>
        {error && (
          <span className="inline-flex items-center gap-1 text-callout text-danger" role="alert">
            <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <span
      className="inline-flex flex-wrap items-center gap-2"
      role="group"
      aria-label={`Confirmar exportação de ${SCOPE_LABEL[scope]}`}
    >
      <label
        htmlFor={checkboxId}
        className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-callout text-text2"
      >
        <input
          id={checkboxId}
          type="checkbox"
          className="h-5 w-5 accent-accent"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        Confirmo a exportação (auditada como billing.export)
      </label>
      <Button
        type="button"
        variant="primary"
        disabled={!acknowledged || pending}
        title={
          pending
            ? "Exportando…"
            : !acknowledged
              ? "Confirme a exportação para continuar"
              : `Confirmar exportação de ${SCOPE_LABEL[scope]}`
        }
        onClick={handleExport}
      >
        {pending ? "Exportando…" : "Confirmar exportação"}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        title={pending ? "Aguarde…" : "Cancelar exportação"}
        onClick={cancel}
      >
        Cancelar
      </Button>
      {error && (
        <span className="inline-flex items-center gap-1 text-callout text-danger" role="alert">
          <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          {error}
        </span>
      )}
    </span>
  );
}
