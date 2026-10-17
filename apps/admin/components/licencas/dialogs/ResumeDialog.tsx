"use client";

import { useState } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Textarea } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { resumeLicense } from "@/lib/licenses";
import { formatDateTimeInTZ } from "@/lib/format";

/**
 * Reativação (`POST /api/licenses/:id/resume`).
 *
 * Só faz sentido em `suspended` — o upstream responde 409 em qualquer outro
 * estado. Volta a licença para `active`.
 *
 * AVISO HONESTO (a tela precisa dizer, senão o operador reativa esperando milagre):
 * reativar NÃO ressuscita prazo. Se o `expiresAt` já passou, a licença volta e
 * o relógio a deriva para graça/expired na mesma hora. O caminho para devolver
 * vigência é `ExtendDialog` (prorrogar), não reativar.
 */
export function ResumeDialog({
  licenseId,
  keyMasked,
  expiresAt,
  graceUntil,
  onClose,
  onDone,
}: {
  licenseId: string;
  keyMasked: string;
  /** ISO-8601 com hora (ou `null` = vitalícia). */
  expiresAt: string | null;
  graceUntil: string | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = reason.trim().length >= 10;
  const expired = expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      await resumeLicense(licenseId, reason.trim());
      onDone?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao reativar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Reativar licença" size="md" pending={pending}>
      <RequirePerm perm="license.adjust">
        <p className="mt-0 text-callout text-text2">
          A chave <code className="font-mono tnum text-[0.85em]">{keyMasked}</code> volta a validar.
          {expiresAt ? (
            <>
              {" "}
              Vencimento: <strong className="text-text1">{formatDateTimeInTZ(expiresAt)}</strong>
              {graceUntil ? ` · graça até ${formatDateTimeInTZ(graceUntil)}` : ""}.
            </>
          ) : (
            <> Licença vitalícia (sem vencimento).</>
          )}
        </p>
        {expired && (
          <p
            className="flex items-start gap-2 rounded-base border border-line2 bg-bg2 px-2.5 py-2 text-callout text-text1"
            role="status"
          >
            <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
            <span>
              Esta licença <strong>já venceu</strong>. Reativar não volta no tempo: ao reativar ela
              entra em graça (3 dias) ou expira de novo, conforme o relógio. Para devolver a vigência
              use <strong>Prorrogar</strong>.
            </span>
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <Field
            label="Motivo (mín. 10 caracteres, auditado)"
            htmlFor="resume-reason"
            error={reason.length > 0 && !valid ? "Mínimo de 10 caracteres." : null}
          >
            <Textarea
              id="resume-reason"
              rows={3}
              autoFocus
              value={reason}
              disabled={pending}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: análise de chargeback encerrada sem irregularidade"
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
              loadingLabel="Reativando…"
              disabled={!valid || pending}
              title={pending ? "Reativando…" : !valid ? "Preencha o motivo (mín. 10 caracteres)" : "Reativar esta licença"}
            >
              <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
              Reativar licença
            </Button>
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}
