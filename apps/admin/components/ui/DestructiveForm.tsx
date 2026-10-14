"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "./Button";
import { Field, Textarea } from "./Field";

/** Motivo mínimo travado (DS §9 / 06 §4): `trim().length >= 10`, auditado. */
export const MOTIVO_MIN = 10;

export function isMotivoValid(motivo: string, min = MOTIVO_MIN): boolean {
  return motivo.trim().length >= min;
}

/**
 * Padrão-ouro de formulário destrutivo (DS §9 / 06 §4) — 2 passos:
 * 1. `textarea` motivo (`rows=3`, `autoFocus`) + 2. `checkbox`
 * "Confirmo … e entendo que é auditado" + submit travado por
 * `valid = motivo && confirmado`.
 *
 * Usado por Revoke/Renew/Adjust/Bonus/Refund/Cancel/Settle/Replay
 * (diálogos concretos mantêm seu próprio estado; novos usam este).
 * Erro de submit em `.form-error[role=alert]` acima do footer;
 * `pending` trava tudo; label da ação carrega o objeto.
 */
export function DestructiveForm({
  reasonLabel = "Motivo (mín. 10 caracteres, auditado)",
  reasonId,
  confirmText = "Confirmo e entendo que é auditado",
  confirmId,
  submitLabel,
  submitVariant = "destructive",
  backLabel = "Voltar",
  pending = false,
  error,
  autoFocusReason = true,
  onBack,
  onSubmit,
}: {
  reasonLabel?: string;
  reasonId?: string;
  confirmText?: string;
  confirmId?: string;
  submitLabel: string;
  submitVariant?: "destructive" | "primary";
  backLabel?: string;
  pending?: boolean;
  error?: string | null;
  autoFocusReason?: boolean;
  onBack: () => void;
  /** Recebe o motivo já com `trim()`; nunca limpa o campo em erro de rede. */
  onSubmit: (motivo: string) => void | Promise<void>;
}) {
  const [motivo, setMotivo] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const valid = isMotivoValid(motivo) && confirmed;

  const rid = reasonId ?? "destructive-motivo";
  const cid = confirmId ?? "destructive-confirm";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    await onSubmit(motivo.trim());
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label={reasonLabel} htmlFor={rid}>
        <Textarea
          id={rid}
          autoFocus={autoFocusReason}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          disabled={pending}
          aria-describedby={`${rid}-hint`}
        />
      </Field>
      <div className="mb-4">
        <label
          htmlFor={cid}
          className="flex items-center gap-2 min-h-[44px] cursor-pointer text-body text-text1"
        >
          <input
            id={cid}
            type="checkbox"
            className="h-5 w-5 shrink-0 accent-accent"
            checked={confirmed}
            disabled={pending}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {confirmText}
        </label>
      </div>
      {error && (
        <p className="flex items-center gap-2 text-callout text-danger dark:text-[#ff9a9e]" role="alert">
          <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <Button
          type="button"
          variant="secondary"
          onClick={onBack}
          disabled={pending}
          title={pending ? "Aguarde…" : backLabel}
        >
          {backLabel}
        </Button>
        <Button
          type="submit"
          variant={submitVariant}
          loading={pending}
          loadingLabel={`${submitLabel.replace(/…$/, "")}…`}
          disabled={!valid || pending}
          title={
            pending
              ? "Aguarde…"
              : !valid
                ? "Preencha o motivo (mín. 10 caracteres) e confirme"
                : submitLabel
          }
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
