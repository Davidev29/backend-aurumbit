"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { createExpense, type CreateExpenseResult } from "@/lib/finance";
import { useToast } from "@/lib/toast";
import { formatBRL } from "@/lib/format";

function digitsOf(v: string): string {
  return v.replace(/\D/g, "");
}

function barcodeHint(digits: string): string | null {
  if (digits.length === 0) return null;
  if (digits.length === 47) return "Boleto bancário (47) — pagamento via Asaas suportado.";
  if (digits.length === 48) return "Convênio/concessionária (48) — pagamento via Asaas suportado.";
  if (digits.length === 44) return "Código de barras (44) — fora do Bill Payments; siga manual.";
  return `Código com ${digits.length} dígitos — esperado 44 (barra) ou 47/48 (linha digitável).`;
}

const JOB_LABEL: Record<string, string> = {
  QUEUED: "Na fila",
  SCHEDULED: "Agendado via Asaas",
  RUNNING: "Executando",
  DONE: "Pago via Asaas",
  FAILED: "Falha — repetição automática",
  CANCELED: "Manual (fora do Asaas)",
};

/**
 * Nova despesa (exige `finance.manage`, só admin).
 * - Código de barras 47/48 → pagamento via Asaas Bill Payments com
 *   agendamento automático (vencido = imediato, regra Asaas);
 * - fora do Bill Payments (44/outros) → despesa manual preservada;
 * - tudo idempotente (`Idempotency-Key`; duplo clique não duplica);
 * - resultado + sino notificam a automação.
 */
export function ExpenseDialog({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const [supplier, setSupplier] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [barcode, setBarcode] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [payViaAsaas, setPayViaAsaas] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateExpenseResult | null>(null);
  const { notify } = useToast();

  const digits = useMemo(() => digitsOf(barcode), [barcode]);
  const amountCents = useMemo(() => {
    const n = Number(amount.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }, [amount]);
  const barcodeError =
    barcode.trim() !== "" && ![44, 47, 48].includes(digits.length)
      ? `Código com ${digits.length} dígitos — esperado 44, 47 ou 48.`
      : null;
  const valid =
    supplier.trim().length >= 2 && amountCents > 0 && dueDate !== "" && !barcodeError && !pending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await createExpense({
        supplier: supplier.trim(),
        category_id: category.trim() || undefined,
        amount_cents: amountCents,
        due_date: new Date(`${dueDate}T12:00:00.000Z`).toISOString(),
        schedule_date: scheduleDate ? new Date(`${scheduleDate}T12:00:00.000Z`).toISOString() : undefined,
        barcode: digits || undefined,
        description: description.trim() || undefined,
        pay_via_asaas: payViaAsaas,
      });
      setResult(res);
      notify("success", "Despesa criada", `${supplier.trim()} · ${formatBRL(amountCents / 100)}`);
      onDone?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao criar despesa.";
      setError(msg);
      notify("error", "Falha ao criar despesa", msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <RequirePerm perm="finance.manage">
      <Dialog
        open
        onClose={onClose}
        title="Nova despesa"
        pending={pending}
        footer={
          result ? (
            <Button type="button" variant="primary" onClick={onClose}>
              Fechar
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
                Voltar
              </Button>
              <Button
                type="submit"
                form="expense-form"
                variant="primary"
                disabled={!valid}
                title={!valid ? "Preencha fornecedor, valor e vencimento" : "Criar despesa"}
              >
                {pending ? "Criando…" : "Criar despesa"}
              </Button>
            </>
          )
        }
      >
        {result ? (
          <div>
            <p className="mt-0 text-body text-text1">
              Despesa <code className="font-mono tnum text-[0.85em]">{result.payable.id}</code> criada
              {result.duplicate ? " (replay — já existia)" : ""}.
            </p>
            <p className="text-body text-text2">
              {result.job ? (
                <>
                  Automação: <strong>{JOB_LABEL[result.job.status] ?? result.job.status}</strong>
                  {result.job.barcodeMasked ? ` · ${result.job.barcodeMasked}` : ""}
                  {result.job.scheduleDate ? ` · ${result.job.scheduleDate.slice(0, 10)}` : ""}
                  {result.job.lastError ? ` · ${result.job.lastError.slice(0, 120)}` : ""}
                </>
              ) : (
                "Pagamento manual — baixe em /financeiro ao pagar."
              )}
            </p>
            <p className="text-callout text-text2">Acompanhe pelo sino de notificações.</p>
          </div>
        ) : (
          <form id="expense-form" onSubmit={handleSubmit}>
            <Field label="Fornecedor" htmlFor="exp-supplier">
              <Input
                id="exp-supplier"
                placeholder="Ex.: Energia S.A."
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Valor (R$)" htmlFor="exp-amount" hint={amountCents > 0 ? formatBRL(amountCents / 100) : undefined}>
                <Input
                  id="exp-amount"
                  mono
                  inputMode="decimal"
                  placeholder="Ex.: 249,90"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Categoria (opcional)" htmlFor="exp-category">
                <Input
                  id="exp-category"
                  placeholder="Ex.: Infraestrutura"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Vencimento" htmlFor="exp-due">
                <Input id="exp-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field
                label="Pagar em (opcional)"
                htmlFor="exp-schedule"
                hint="Vazio = no vencimento. Vencido paga na hora (regra Asaas)."
              >
                <Input
                  id="exp-schedule"
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                />
              </Field>
            </div>
            <Field
              label="Código de barras / linha digitável (opcional)"
              htmlFor="exp-barcode"
              hint={barcodeHint(digits) ?? "44 (barra) ou 47/48 (linha digitável). DV validado no backend."}
              error={barcodeError ?? error}
            >
              <Input
                id="exp-barcode"
                mono
                inputMode="numeric"
                placeholder="Ex.: 00190.00009 02759.288000…"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Descrição (opcional)" htmlFor="exp-desc">
              <Textarea
                id="exp-desc"
                rows={2}
                placeholder="Ex.: Fatura de energia da sede — jan/26"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div>
              <label htmlFor="exp-asaas" className="flex gap-2 items-center text-body text-text1">
                <input
                  id="exp-asaas"
                  type="checkbox"
                  checked={payViaAsaas}
                  onChange={(e) => setPayViaAsaas(e.target.checked)}
                  className="w-5 h-5 shrink-0"
                  style={{ accentColor: "var(--accent)" }}
                />
                Pagar via Asaas quando suportado (47/48; 44 segue manual)
              </label>
            </div>
          </form>
        )}
      </Dialog>
    </RequirePerm>
  );
}
