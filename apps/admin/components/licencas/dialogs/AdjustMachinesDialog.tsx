"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { ApiClientError } from "@/lib/api/client";
import { RequirePerm } from "@/lib/auth/permissions";
import { adjustMachines } from "@/lib/licenses";

const TEXTAREA_CLASS =
  "w-full min-h-[44px] px-3 py-2 rounded-base text-body text-text1 bg-bg2 border border-line2 placeholder:text-text3 focus-ring";

/**
 * Ajuste de limite de máquinas (REQUIREMENTS §2/§5).
 * Exige `license.adjust` + justificativa >= 10 caracteres. POST idempotente.
 */
export function AdjustMachinesDialog({
  licenseId,
  machinesAllowed,
  onClose,
  onDone,
}: {
  licenseId: string;
  machinesAllowed: number;
  onClose: () => void;
  onDone?: (machinesAllowed: number) => void;
}) {
  const [delta, setDelta] = useState("1");
  const [justificativa, setJustificativa] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deltaNum = Number.parseInt(delta, 10);
  const deltaValid = Number.isInteger(deltaNum) && deltaNum !== 0 && Math.abs(deltaNum) <= 100;
  const justificativaValid = justificativa.trim().length >= 10;
  const valid = deltaValid && justificativaValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await adjustMachines(licenseId, { delta: deltaNum, justificativa: justificativa.trim() });
      onDone?.(res.machinesAllowed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ajustar o limite.");
      if (!(err instanceof ApiClientError)) {
        // Mantém diálogo aberto p/ correção.
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Ajustar limite de máquinas" pending={pending}>
      <RequirePerm perm="license.adjust">
        <p className="mt-0 text-callout text-text2">
          Limite atual: <strong className="text-text1">{machinesAllowed}</strong>. Enforcement no
          backend (FOR UPDATE).
        </p>
        <form onSubmit={handleSubmit}>
          <Field label="Delta (ex.: +1, -2)" htmlFor="adjust-delta" hint="Diferente de zero, |delta| ≤ 100.">
            <Input
              id="adjust-delta"
              type="number"
              step={1}
              autoFocus
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              aria-describedby="adjust-delta-hint"
            />
          </Field>
          <Field label="Justificativa (mín. 10 caracteres)" htmlFor="adjust-just">
            <textarea
              id="adjust-just"
              className={TEXTAREA_CLASS}
              rows={3}
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
            />
          </Field>
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
              variant="primary"
              disabled={!valid || pending}
              title={pending ? "Salvando…" : !valid ? "Preencha delta e justificativa válidos" : "Confirmar ajuste"}
            >
              {pending ? "Salvando…" : "Confirmar ajuste"}
            </Button>
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}
