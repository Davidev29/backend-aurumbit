"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { DestructiveForm } from "@/components/ui/DestructiveForm";
import { RequirePerm } from "@/lib/auth/permissions";

/**
 * Bloqueio/liberação de acesso do cliente (2 passos: motivo ≥10 + checkbox).
 * Exige `license.adjust` (guarda mais próxima; autorização real no backend).
 * TODO(backend pronto): `POST /v1/customers/:id/(block|unblock)` + audit real;
 * hoje aplica localmente na sessão e sintetiza `auditId` (stub explícito).
 */
export function BlockCustomerDialog({
  customerId,
  customerName,
  blocked,
  onClose,
  onDone,
}: {
  customerId: string;
  customerName: string;
  /** `true` ⇔ cliente já bloqueado (ação passa a ser liberar). */
  blocked: boolean;
  onClose: () => void;
  onDone: (nextBlocked: boolean, auditId: string, motivo: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(motivo: string) {
    setPending(true);
    setError(null);
    try {
      // Stub: sem endpoint de bloqueio no Nest — aplica local + trilha sintética.
      await new Promise((r) => setTimeout(r, 400));
      onDone(!blocked, `aud-customer-${customerId}-${Date.now()}`, motivo);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar o acesso.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={blocked ? `Liberar acesso — ${customerName}` : `Bloquear acesso — ${customerName}`}
      size="sm"
      pending={pending}
    >
      <RequirePerm perm="license.adjust">
        <p className="mt-0 text-callout text-text2">
          {blocked
            ? "O cliente volta a autenticar e usar as licenças ativas. Registrado em auditoria."
            : "O cliente deixa de autenticar (sessões derrubadas no próximo online). Irreversível por esta tela apenas via nova liberação. Registrado em auditoria."}
        </p>
        <DestructiveForm
          submitLabel={blocked ? "Liberar acesso" : "Bloquear acesso"}
          submitVariant={blocked ? "primary" : "destructive"}
          pending={pending}
          error={error}
          onBack={onClose}
          onSubmit={handleSubmit}
        />
      </RequirePerm>
    </Dialog>
  );
}
