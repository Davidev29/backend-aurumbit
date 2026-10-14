"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { grantBonus } from "@/lib/licenses";

const TEXTAREA_CLASS =
  "w-full min-h-[44px] px-3 py-2 rounded-base text-body text-text1 bg-bg2 border border-line2 placeholder:text-text3 focus-ring";

/**
 * Concessão de bônus (REQUIREMENTS §2: motivo >= 10; vitalícia `ends_at null` revogável).
 * Exige `bonus.grant`. Sem financeiro real — só cria entitlement de bônus.
 */
export function BonusDialog({
  licenseId,
  onClose,
  onDone,
}: {
  licenseId: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [reason, setReason] = useState("");
  const [lifetime, setLifetime] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonValid = reason.trim().length >= 10;
  const endsAtValid = lifetime || (endsAt !== "" && !Number.isNaN(new Date(endsAt).getTime()));
  const valid = reasonValid && endsAtValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      await grantBonus(licenseId, {
        reason: reason.trim(),
        endsAt: lifetime ? null : new Date(endsAt).toISOString(),
      });
      onDone?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao conceder bônus.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Conceder bônus" pending={pending}>
      <RequirePerm perm="bonus.grant">
        <form onSubmit={handleSubmit}>
          <Field label="Motivo (mín. 10 caracteres)" htmlFor="bonus-reason">
            <textarea
              id="bonus-reason"
              className={TEXTAREA_CLASS}
              rows={3}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="mb-4">
            <label
              htmlFor="bonus-lifetime"
              className="flex items-center gap-2 min-h-[44px] cursor-pointer text-body text-text1"
            >
              <input
                id="bonus-lifetime"
                type="checkbox"
                className="h-5 w-5 accent-accent"
                checked={lifetime}
                onChange={(e) => setLifetime(e.target.checked)}
              />
              Bônus vitalício (revogável, `ends_at` nulo)
            </label>
          </div>
          {!lifetime && (
            <Field label="Prazo (término)" htmlFor="bonus-ends">
              <Input
                id="bonus-ends"
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </Field>
          )}
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
              title={pending ? "Salvando…" : !valid ? "Preencha motivo e prazo válidos" : "Conceder bônus"}
            >
              {pending ? "Salvando…" : "Conceder bônus"}
            </Button>
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}
