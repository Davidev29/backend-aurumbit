"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { revokeLicense } from "@/lib/licenses";

const TEXTAREA_CLASS =
  "w-full min-h-[44px] px-3 py-2 rounded-base text-body text-text1 bg-bg2 border border-line2 placeholder:text-text3 focus-ring";

/**
 * Revogação (PROJECT §2: bump `token_version` — invalida JWTs e
 * offline-tokens no próximo online). Exige `license.adjust` + confirmação
 * explícita. Ação destrutiva: bloqueada em graça degradada pelo backend.
 */
export function RevokeDialog({
  licenseId,
  keyMasked,
  onClose,
  onDone,
}: {
  licenseId: string;
  keyMasked: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = motivo.trim().length >= 10 && confirmed;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      await revokeLicense(licenseId, { motivo: motivo.trim(), confirmacao: true });
      onDone?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao revogar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Revogar licença" pending={pending}>
      <RequirePerm perm="license.adjust">
        <p className="mt-0 text-callout text-text2">
          Licença <code className="font-mono tnum text-[0.85em]">{keyMasked}</code> será invalidada
          (bump <code className="font-mono tnum text-[0.85em]">token_version</code>). Irreversível por
          esta tela.
        </p>
        <form onSubmit={handleSubmit}>
          <Field label="Motivo (mín. 10 caracteres, auditado)" htmlFor="revoke-motivo">
            <textarea
              id="revoke-motivo"
              className={TEXTAREA_CLASS}
              rows={3}
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </Field>
          <div className="mb-4">
            <label
              htmlFor="revoke-confirm"
              className="flex items-center gap-2 min-h-[44px] cursor-pointer text-body text-text1"
            >
              <input
                id="revoke-confirm"
                type="checkbox"
                className="h-5 w-5 accent-accent"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Confirmo a revogação e entendo que sessões caem no próximo online
            </label>
          </div>
          {error && (
            <p className="flex items-center gap-2 text-callout text-danger" role="alert">
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
              variant="destructive"
              disabled={!valid || pending}
              title={
                pending
                  ? "Revogando…"
                  : !valid
                    ? "Preencha o motivo e confirme a revogação"
                    : "Revogar licença (irreversível por esta tela)"
              }
            >
              {pending ? "Revogando…" : "Revogar licença"}
            </Button>
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}
