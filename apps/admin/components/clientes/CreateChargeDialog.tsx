"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";

export interface CreatedCharge {
  id: string;
  title: string;
  amount: number;
  dueDate: string;
  correlationId: string;
  auditId: string;
}

/** Converte "149,90" / "149.90" em reais. */
function parseBRL(raw: string): number | null {
  const norm = raw.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return null;
  const v = Number(norm);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

/**
 * Nova cobrança avulsa (título + valor + vencimento + recurso contratado).
 * Exige `billing.manage` (mesma regra de refund/cancel).
 * TODO(backend pronto): `POST /v1/billing/invoices` (B7 CRIAR) + audit
 * `billing.invoice.created`; hoje registra rascunho local (stub explícito).
 */
export function CreateChargeDialog({
  customerId,
  customerName,
  onClose,
  onDone,
}: {
  customerId: string;
  customerName: string;
  onClose: () => void;
  onDone: (charge: CreatedCharge) => void;
}) {
  const [title, setTitle] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [resource, setResource] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = parseBRL(amountRaw);
  const titleValid = title.trim().length >= 4;
  const dueValid = dueDate !== "" && !Number.isNaN(new Date(`${dueDate}T12:00:00.000Z`).getTime());
  const resourceValid = resource.trim().length >= 10;
  const valid = titleValid && amount !== null && dueValid && resourceValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const stamp = Date.now();
      await new Promise((r) => setTimeout(r, 500));
      onDone({
        id: `inv-${customerId}-${stamp}`,
        title: title.trim(),
        amount: amount as number,
        dueDate: new Date(`${dueDate}T12:00:00.000Z`).toISOString(),
        correlationId: `corr-${customerId}-${stamp}`,
        auditId: `aud-charge-${customerId}-${stamp}`,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar a cobrança.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Gerar cobrança — ${customerName}`} pending={pending}>
      <RequirePerm perm="billing.manage">
        <p className="mt-0 text-callout text-text2">
          Cobrança avulsa (ex.: novo recurso contratado). Stub — sem endpoint de criação no Nest
          (B7 CRIAR); o rascunho fica visível nesta sessão até o backend assumir.
        </p>
        <form onSubmit={handleSubmit}>
          <Field label="Título da cobrança" htmlFor="charge-title" hint="Ex.: Módulo fiscal — ativação">
            <Input
              id="charge-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título da cobrança"
              disabled={pending}
            />
          </Field>
          <Field label="Valor (R$)" htmlFor="charge-amount" hint="Ex.: 149,90">
            <Input
              id="charge-amount"
              mono
              inputMode="decimal"
              value={amountRaw}
              onChange={(e) => setAmountRaw(e.target.value)}
              placeholder="0,00"
              disabled={pending}
              aria-invalid={amountRaw !== "" && amount === null}
            />
          </Field>
          <Field label="Vencimento" htmlFor="charge-due">
            <Input
              id="charge-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={pending}
            />
          </Field>
          <Field
            label="Recurso contratado (mín. 10 caracteres, auditado)"
            htmlFor="charge-resource"
            hint="A que se refere a cobrança (novo recurso, upgrade, serviço)."
          >
            <Textarea
              id="charge-resource"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
              disabled={pending}
              placeholder="Descreva o recurso contratado pelo cliente"
            />
          </Field>
          {amountRaw !== "" && amount === null && (
            <p className="text-callout text-danger dark:text-[#ff9a9e]" role="alert">
              Valor inválido — use o formato 149,90.
            </p>
          )}
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
              loadingLabel="Gerando…"
              disabled={!valid || pending}
              title={pending ? "Gerando…" : !valid ? "Preencha título, valor, vencimento e recurso" : "Gerar cobrança"}
            >
              Gerar cobrança
            </Button>
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}
