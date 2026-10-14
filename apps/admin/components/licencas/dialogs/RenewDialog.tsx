"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { renewLicense } from "@/lib/licenses";

const SELECT_CLASS =
  "w-full min-h-[44px] px-3 rounded-base text-body text-text1 bg-bg2 border border-line2 focus-ring";

/**
 * Renovação (PROJECT §1: em graça mantém continuidade —
 * `starts_at = max(now, expires_at_anterior)`; calendário UTC 1M/12M).
 * Exige `license.adjust`.
 */
export function RenewDialog({
  licenseId,
  expiresAt,
  onClose,
  onDone,
}: {
  licenseId: string;
  expiresAt: string;
  onClose: () => void;
  onDone?: (expiresAt: string) => void;
}) {
  const [months, setMonths] = useState<1 | 12>(12);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await renewLicense(licenseId, { months });
      onDone?.(res.expiresAt);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao renovar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Renovar licença" pending={pending}>
      <RequirePerm perm="license.adjust">
        <p className="mt-0 text-callout text-text2">
          Vigência inicia na confirmação do pagamento; renovação em graça mantém continuidade.
        </p>
        <form onSubmit={handleSubmit}>
          <Field label={`Período (expiração atual: ${expiresAt})`} htmlFor="renew-months">
            <select
              id="renew-months"
              className={SELECT_CLASS}
              value={months}
              onChange={(e) => setMonths(e.target.value === "1" ? 1 : 12)}
            >
              <option value={1}>Mensal (1M calendário UTC)</option>
              <option value={12}>Anual (12M calendário UTC)</option>
            </select>
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
              disabled={pending}
              title={pending ? "Renovando…" : "Confirmar renovação"}
            >
              {pending ? "Renovando…" : "Confirmar renovação"}
            </Button>
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}
