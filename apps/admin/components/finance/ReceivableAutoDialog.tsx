"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { createReceivableAuto, type CreateAutoReceivableResult } from "@/lib/finance";
import { useToast } from "@/lib/toast";
import { formatBRL } from "@/lib/format";

/**
 * Nova receita automática (exige `finance.manage`, só admin).
 * Cria o recebível e emite a cobrança Asaas automaticamente
 * (PIX/boleto). A baixa acontece sozinha na confirmação
 * (webhook/reconciliação → sync idempotente). Tudo idempotente
 * (`Idempotency-Key`; duplo clique não recobra).
 */
export function ReceivableAutoDialog({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const [customerName, setCustomerName] = useState("");
  const [asaasCustomerId, setAsaasCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [billingType, setBillingType] = useState<"PIX" | "BOLETO" | "UNDEFINED">("PIX");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateAutoReceivableResult | null>(null);
  const { notify } = useToast();

  const amountCents = useMemo(() => {
    const n = Number(amount.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }, [amount]);
  const valid =
    customerName.trim().length >= 2 &&
    asaasCustomerId.trim().length >= 1 &&
    amountCents > 0 &&
    dueDate !== "" &&
    !pending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await createReceivableAuto({
        customer_name: customerName.trim(),
        asaas_customer_id: asaasCustomerId.trim(),
        amount_cents: amountCents,
        due_date: new Date(`${dueDate}T12:00:00.000Z`).toISOString(),
        billing_type: billingType,
        description: description.trim() || undefined,
      });
      setResult(res);
      notify("success", "Receita automática emitida", `${customerName.trim()} · ${formatBRL(amountCents / 100)}`);
      onDone?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao criar receita automática.";
      setError(msg);
      notify("error", "Falha ao emitir cobrança", msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <RequirePerm perm="finance.manage">
      <Dialog
        open
        onClose={onClose}
        title="Receita automática (Asaas)"
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
                form="receivable-auto-form"
                variant="primary"
                disabled={!valid}
                title={!valid ? "Preencha cliente, ID Asaas, valor e vencimento" : "Emitir cobrança"}
              >
                {pending ? "Emitindo…" : "Emitir cobrança"}
              </Button>
            </>
          )
        }
      >
        {result ? (
          <div>
            <p className="mt-0 text-body text-text1">
              Recebível <code className="font-mono tnum text-[0.85em]">{result.receivable.id}</code> criado
              {result.duplicate ? " (replay — já existia)" : ""}.
            </p>
            <p className="text-body text-text2">
              Cobrança <code className="font-mono tnum text-[0.85em]">{result.chargeId ?? "—"}</code> emitida no
              Asaas. A baixa é automática na confirmação.
            </p>
            {result.identificationField && (
              <Field label="Linha digitável" htmlFor="auto-charge-line">
                <Input id="auto-charge-line" mono readOnly value={result.identificationField} onFocus={(e) => e.target.select()} />
              </Field>
            )}
            <p className="text-callout text-text2">Acompanhe pelo sino de notificações.</p>
          </div>
        ) : (
          <form id="receivable-auto-form" onSubmit={handleSubmit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cliente" htmlFor="auto-customer">
                <Input
                  id="auto-customer"
                  placeholder="Ex.: Alice Alves"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field label="ID do cliente no Asaas" htmlFor="auto-cus" hint="cus_* (cadastro no Asaas).">
                <Input
                  id="auto-cus"
                  mono
                  placeholder="Ex.: cus_000005219613"
                  value={asaasCustomerId}
                  onChange={(e) => setAsaasCustomerId(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Valor (R$)" htmlFor="auto-amount" hint={amountCents > 0 ? formatBRL(amountCents / 100) : undefined}>
                <Input
                  id="auto-amount"
                  mono
                  inputMode="decimal"
                  placeholder="Ex.: 149,90"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Vencimento" htmlFor="auto-due">
                <Input id="auto-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field label="Tipo" htmlFor="auto-type">
                <Select id="auto-type" value={billingType} onChange={(e) => setBillingType(e.target.value as typeof billingType)}>
                  <option value="PIX">PIX</option>
                  <option value="BOLETO">Boleto</option>
                  <option value="UNDEFINED">Pagador escolhe</option>
                </Select>
              </Field>
            </div>
            <Field label="Descrição (opcional)" htmlFor="auto-desc" error={error}>
              <Textarea
                id="auto-desc"
                rows={2}
                placeholder="Ex.: Mensalidade Aurum Pro — nov/26"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </form>
        )}
      </Dialog>
    </RequirePerm>
  );
}
