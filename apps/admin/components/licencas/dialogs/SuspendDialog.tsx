"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Textarea } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { suspendLicense } from "@/lib/licenses";

/**
 * Suspensão (`POST /v1/licenses/:id/suspend`).
 *
 * NÃO é revogação: a chave continua pertencendo ao cliente e pode voltar com
 * `/resume`. Use suspensão para bloqueio temporário (investigação, inadimplência
 * em análise); use `RevokeDialog` quando o direito acabou.
 *
 * Estados onde o upstream responde 409 (a UI esconde a ação, mas o 409 continua
 * sendo a última linha): revogada, já suspensa, pendente de pagamento, expirada
 * ("renove" é o caminho dela, não suspender).
 *
 * Não é destrutiva → botão primário (DS §9: destrutivo em 2 passos), motivo
 * auditado >= 10 caracteres.
 */
export function SuspendDialog({
  licenseId,
  keyMasked,
  expiresAt,
  onClose,
  onDone,
}: {
  licenseId: string;
  keyMasked: string;
  /** ISO-8601 com hora — a suspensão não muda a data; ela é só contexto. */
  expiresAt: string | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = reason.trim().length >= 10;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      await suspendLicense(licenseId, reason.trim());
      onDone?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao suspender.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Suspender licença" size="md" pending={pending}>
      <RequirePerm perm="license.adjust">
        <p className="mt-0 text-callout text-text2">
          A chave <code className="font-mono tnum text-[0.85em]">{keyMasked}</code> deixa de validar,
          mas{" "}
          <strong className="text-text1">não é revogada</strong>: a data de vencimento
          {expiresAt ? " e a chave continuam as mesmas" : " continua a mesma"} e a licença pode ser
          reativada depois. Diferente da revogação, suspender não invalida tokens emitidos.
        </p>
        <form onSubmit={handleSubmit}>
          <Field
            label="Motivo (mín. 10 caracteres, auditado)"
            htmlFor="suspend-reason"
            error={reason.length > 0 && !valid ? "Mínimo de 10 caracteres." : null}
          >
            <Textarea
              id="suspend-reason"
              rows={3}
              autoFocus
              value={reason}
              disabled={pending}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: bloqueio temporário durante análise de chargeback"
              aria-invalid={!valid}
            />
          </Field>
          {error && (
            <p
              className="flex items-center gap-2 text-callout text-danger dark:text-[#ff9a9e]"
              role="alert"
            >
              <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
              title={pending ? "Aguarde…" : "Cancelar"}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={pending}
              loadingLabel="Suspendendo…"
              disabled={!valid || pending}
              title={pending ? "Suspendendo…" : !valid ? "Preencha o motivo (mín. 10 caracteres)" : "Suspender esta licença"}
            >
              Suspender licença
            </Button>
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}
