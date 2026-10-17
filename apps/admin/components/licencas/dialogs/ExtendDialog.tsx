"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { extendLicense } from "@/lib/licenses";
import { formatDateTimeInTZ } from "@/lib/format";

/**
 * Prorrogação IN-PLACE (`POST /v1/licenses/:id/extend`).
 *
 * Estende a MESMA licença: o cliente continua com a MESMA chave e com os
 * mesmos vínculos de máquina. É o caminho do "resgatar chave vencida sem ter
 * que trocar a chave do cliente" — distinto de `RenewDialog`, que EMITE
 * licença nova (outra chave).
 *
 * Regras refletidas na UI (o backend é a última linha, 409 lá):
 * - `revoked` → não chega aqui (ver `licenseActionRules` no painel).
 * - sem `expiresAt` (vitalícia) → escondido: o upstream responde
 *   `LIFETIME_NO_EXTEND` porque não existe vencimento a prorrogar.
 * - meses 1..12 (calendário UTC) + justificativa >= 10 (auditada).
 * - `graceUntil` é recalculado pelo backend como `expiresAt + 3d`.
 */
export function ExtendDialog({
  licenseId,
  keyMasked,
  expiresAt,
  onClose,
  onDone,
}: {
  licenseId: string;
  keyMasked: string;
  /** ISO-8601 com hora; `null` = vitalícia (o diálogo nem deve ser aberto). */
  expiresAt: string | null;
  onClose: () => void;
  onDone?: (expiresAt: string | null) => void;
}) {
  const [months, setMonths] = useState(1);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonOk = reason.trim().length >= 10;
  const monthsOk = Number.isInteger(months) && months >= 1 && months <= 12;
  const valid = reasonOk && monthsOk;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await extendLicense(licenseId, { months, reason: reason.trim() });
      onDone?.(res.license?.expiresAt ?? null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao prorrogar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Prorrogar licença" size="md" pending={pending}>
      <RequirePerm perm="license.adjust">
        <p className="mt-0 text-callout text-text2">
          A chave <code className="font-mono tnum text-[0.85em]">{keyMasked}</code> continua a mesma —{" "}
          {expiresAt ? (
            <>
              hoje expira <strong className="text-text1">{formatDateTimeInTZ(expiresAt)}</strong> e a
              nova janela de graça será <strong className="text-text1">3 dias</strong> após o novo
              vencimento.
            </>
          ) : (
            <span className="text-text2">esta licença não tem vencimento (vitalícia).</span>
          )}
        </p>
        <form onSubmit={handleSubmit}>
          <Field
            label="Por quantos meses"
            htmlFor="extend-months"
            hint="Meses-calendário contados a partir do vencimento atual (ou de hoje, se já venceu). 1 a 12."
          >
            <Select
              id="extend-months"
              mono
              value={String(months)}
              disabled={pending}
              onChange={(e) => setMonths(Number(e.target.value))}
              aria-invalid={!monthsOk}
            >
              <option value="1">1 mês</option>
              <option value="3">3 meses</option>
              <option value="6">6 meses</option>
              <option value="12">12 meses</option>
            </Select>
          </Field>
          <Field
            label="Justificativa (mín. 10 caracteres, auditada)"
            htmlFor="extend-reason"
            error={reason.length > 0 && !reasonOk ? "Mínimo de 10 caracteres." : null}
          >
            <Textarea
              id="extend-reason"
              rows={3}
              autoFocus
              value={reason}
              disabled={pending}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: falha recorrente de cobrança, acordo comercial de reanálise"
              aria-invalid={!reasonOk}
            />
          </Field>
          <p className="mt-0 text-[11px] text-text2">
            Prorrogar <strong className="text-text1">{months}</strong>{" "}
            {months === 1 ? "mês" : "meses"} a partir do vencimento atual.
          </p>
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
              loadingLabel="Prorrogando…"
              disabled={!valid || pending}
              title={pending ? "Prorrogando…" : !valid ? "Preencha a justificativa (mín. 10 caracteres)" : "Prorrogar esta licença"}
            >
              Prorrogar licença
            </Button>
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}
