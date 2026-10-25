"use client";

import { useState } from "react";
import { ApiClientError } from "@/lib/api/client";
import { RequirePerm } from "@/lib/auth/permissions";
import { settlePayable, settleReceivable } from "@/lib/finance";
import { useToast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { formatBRL } from "@/lib/format";

export type SettleKind = "pay" | "receive";

/**
 * Liquidação pagar/baixar (Fase 5).
 * Exige `finance.manage` (só admin) + motivo (>= 10, auditado) + confirmação
 * explícita. Cria o `Transaction` realizado no backend via `assertTransition`
 * (REQUIREMENTS §3). POSTs carregam `Idempotency-Key` (PROJECT §5).
 */
export function SettleDialog({
  kind,
  id,
  title,
  amount,
  onClose,
  onDone,
}: {
  kind: SettleKind;
  id: string;
  title: string;
  amount: number;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 422 `ACCOUNT_REQUIRED`: o backend (modo real) exige `account_id` no settle.
  // Seletor revelado só nesse caso; repassado de forma forward-compatible
  // (o BFF atual ignora campos extras no stub e repassa o corpo no modo real).
  const [needsAccount, setNeedsAccount] = useState(false);
  const [accountId, setAccountId] = useState("");
  const { notify } = useToast();

  const valid =
    motivo.trim().length >= 10 && confirmed && (!needsAccount || accountId.trim().length > 0);
  const verb = kind === "pay" ? "Pagar" : "Baixar";
  const fieldId = kind === "pay" ? "settle-pay-motivo" : "settle-receive-motivo";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const req = {
        motivo: motivo.trim(),
        confirmacao: true,
        ...(needsAccount && accountId.trim() ? { accountId: accountId.trim() } : {}),
      };
      if (kind === "pay") {
        await settlePayable(id, req);
      } else {
        await settleReceivable(id, req);
      }
      notify("success", kind === "pay" ? "Conta paga" : "Recebimento baixado", `${title} · ${formatBRL(amount)}`);
      onDone?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "ACCOUNT_REQUIRED") {
        setNeedsAccount(true);
      }
      const msg = err instanceof Error ? err.message : `Falha ao ${verb.toLowerCase()}.`;
      setError(msg);
      notify("error", `Falha ao ${verb.toLowerCase()}`, msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <RequirePerm perm="finance.manage">
      <Dialog
        open
        onClose={onClose}
        title={`${verb} — ${title}`}
        pending={pending}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Voltar
            </Button>
            <Button
              type="submit"
              form={`${fieldId}-form`}
              variant="primary"
              disabled={!valid || pending}
              title={!valid ? "Informe o motivo (mín. 10 caracteres) e confirme" : verb}
            >
              {pending ? `${verb}ando…` : `${verb}`}
            </Button>
          </>
        }
      >
        <p className="mt-0 text-body text-text2">
          <code className="font-mono tnum text-[0.85em]">{id}</code> ({formatBRL(amount)}) será marcada
          como <code className="font-mono tnum text-[0.85em]">{kind === "pay" ? "PAGO" : "RECEBIDO"}</code>,
          gerando o lançamento realizado no extrato. A ação é auditada.
        </p>
        <form id={`${fieldId}-form`} onSubmit={handleSubmit}>
          <Field label="Motivo (mín. 10 caracteres, auditado)" htmlFor={fieldId} error={error}>
            <textarea
              id={fieldId}
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-base font-inherit text-body text-text1 bg-bg2 border border-line2 placeholder:text-text3 focus-ring"
            />
          </Field>
          {needsAccount && (
            <Field
              label="Conta (account_id)"
              htmlFor={`${fieldId}-account`}
              hint="O backend exigiu a conta de liquidação (422 ACCOUNT_REQUIRED)."
            >
              <Input
                id={`${fieldId}-account`}
                mono
                placeholder="Ex.: acc-…"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              />
            </Field>
          )}
          <div>
            <label
              htmlFor={`${fieldId}-confirm`}
              className="flex gap-2 items-center text-body text-text1"
            >
              <input
                id={`${fieldId}-confirm`}
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="w-5 h-5 shrink-0"
                style={{ accentColor: "var(--accent)" }}
              />
              Confirmo e entendo que é auditado
            </label>
          </div>
        </form>
      </Dialog>
    </RequirePerm>
  );
}
