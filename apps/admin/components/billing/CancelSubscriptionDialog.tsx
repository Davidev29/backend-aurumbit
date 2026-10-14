"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { cancelSubscription } from "@/lib/billing";

const TEXTAREA_CLASS =
  "w-full min-h-[44px] px-3 py-2 rounded-base text-body text-text1 bg-bg2 border border-line2 placeholder:text-text3 focus-ring";

/**
 * Cancelamento de assinatura (Fase 4).
 * Exige `billing.manage` + motivo (>= 10, auditado) + confirmação explícita.
 * A autorização real é do backend (403); o botão de abertura já vem
 * desabilitado sem a permissão.
 */
export function CancelSubscriptionDialog({
  subscriptionId,
  planName,
  onClose,
  onDone,
}: {
  subscriptionId: string;
  planName: string;
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
      await cancelSubscription(subscriptionId, { motivo: motivo.trim(), confirmacao: true });
      onDone?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Cancelar assinatura" pending={pending}>
      <RequirePerm perm="billing.manage">
        <p className="mt-0 text-callout text-text2">
          Assinatura <code className="font-mono tnum text-[0.85em]">{subscriptionId}</code> (
          {planName}) deixará de gerar cobranças. Faturas já emitidas não são alteradas.
        </p>
        <form onSubmit={handleSubmit}>
          <Field label="Motivo (mín. 10 caracteres, auditado)" htmlFor="cancel-sub-motivo">
            <textarea
              id="cancel-sub-motivo"
              className={TEXTAREA_CLASS}
              rows={3}
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </Field>
          <div className="mb-4">
            <label
              htmlFor="cancel-sub-confirm"
              className="flex items-center gap-2 min-h-[44px] cursor-pointer text-body text-text1"
            >
              <input
                id="cancel-sub-confirm"
                type="checkbox"
                className="h-5 w-5 accent-accent"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Confirmo o cancelamento e entendo que é auditado
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
              title={pending ? "Aguarde…" : "Voltar"}
            >
              Voltar
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!valid || pending}
              title={
                pending
                  ? "Cancelando…"
                  : !valid
                    ? "Preencha o motivo e confirme o cancelamento"
                    : "Cancelar assinatura (auditado)"
              }
            >
              {pending ? "Cancelando…" : "Cancelar assinatura"}
            </Button>
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}
