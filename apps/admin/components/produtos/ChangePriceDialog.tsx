"use client";

import { useState } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { formatBRL } from "@/lib/format";
import { changePlanPrice } from "@/lib/products";
import type { BillingInterval, PlanPriceChangeRequest, PlanView } from "@/lib/types";

/** "149,90" / "149.90" → centavos; `null` = inválido. */
function parseBRLCents(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const norm = t.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return null;
  const v = Number(norm);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 100);
}

function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "YYYY-MM-DD" → "DD/MM" (exibição curta do início de vigência). */
function toDayMonth(iso: string): string {
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

interface ChangePlanPriceResult {
  plan: PlanView;
  oldPlanId: string;
  updatedReceivables: string[];
  auditId: string;
}

const INTERVAL_LABEL: Record<BillingInterval, string> = {
  MONTH: "Mensal",
  YEAR: "Anual",
};

/**
 * Alteração de preço de plano vigente (Dialog glass md — molde de edição,
 * NÃO destrutivo: sem checkbox, submit `primary` "Aplicar novo preço").
 * Novo valor em R$ ("149,90", >0) + vigência a partir de (≥ hoje) + motivo
 * auditado (≥10). Contratos fechados mantêm o preço congelado — só novas
 * cobranças usam o valor vigente. Exige `product.manage`.
 * Sucesso inline (`role=status`) com novo valor + início de vigência + nº de
 * recebíveis atualizados + `auditId`; `onDone` recarrega o produto.
 */
export function ChangePriceDialog({
  productCode,
  plan,
  onClose,
  onDone,
}: {
  productCode: string;
  plan: PlanView;
  onClose: () => void;
  onDone?: () => void;
}) {
  const today = todayISO();
  const [priceRaw, setPriceRaw] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [motivo, setMotivo] = useState("");
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChangePlanPriceResult | null>(null);

  const cents = parseBRLCents(priceRaw);
  const priceInvalid = touched && priceRaw.trim() !== "" && cents === null;
  const dateInvalid = effectiveFrom === "" || effectiveFrom < today;
  const motivoTrimmed = motivo.trim();
  const motivoInvalid = touched && motivoTrimmed.length > 0 && motivoTrimmed.length < 10;
  const valid = cents !== null && !dateInvalid && motivoTrimmed.length >= 10;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await changePlanPrice(productCode, {
        billingInterval: plan.billingInterval,
        newPriceCents: cents as number,
        effectiveFrom,
        motivo: motivoTrimmed,
        confirmacao: true,
      } satisfies PlanPriceChangeRequest);
      setResult(res);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao aplicar novo preço.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Alterar preço — ${plan.name}`}
      size="md"
      material="glass"
      pending={pending}
    >
      <RequirePerm perm="product.manage">
        {result ? (
          <div role="status">
            <p className="m-0 text-body text-text1">
              <Badge tone="ok" state="Preço atualizado">Preço atualizado</Badge> Novo valor{" "}
              <span className="font-mono tnum text-[0.85em]">
                {formatBRL((result.plan?.priceCents ?? cents ?? 0) / 100)}
              </span>{" "}
              a partir de {toDayMonth(effectiveFrom)} · {result.updatedReceivables.length}{" "}
              {result.updatedReceivables.length === 1 ? "recebível atualizado" : "recebíveis atualizados"}{" "}
              · trilha <span className="font-mono tnum text-[0.85em]">{result.auditId}</span>
            </p>
            <p className="mb-0 mt-2 flex items-center gap-2 text-callout text-text2">
              <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              Contratos fechados mantêm o preço congelado; só novas cobranças usam o valor vigente.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button type="button" variant="secondary" onClick={onClose} title="Fechar alteração de preço">
                Fechar
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="mt-0 text-callout text-text2">
              Plano <strong className="text-text1">{plan.name}</strong> · {INTERVAL_LABEL[plan.billingInterval]} ·
              preço atual{" "}
              <span className="font-mono tnum text-[0.85em]">{formatBRL(plan.priceCents / 100)}</span>
            </p>
            <Field
              label="Novo valor (R$)"
              htmlFor="price-new-value"
              hint="Formato 149,90 · maior que zero."
              error={priceInvalid ? "Valor inválido — use o formato 149,90." : null}
            >
              <Input
                id="price-new-value"
                mono
                inputMode="decimal"
                autoComplete="off"
                placeholder="Ex.: 149,90"
                value={priceRaw}
                onChange={(e) => setPriceRaw(e.target.value)}
                onBlur={() => setTouched(true)}
                disabled={pending}
                aria-invalid={priceInvalid}
              />
            </Field>
            <Field
              label="Vigência a partir de"
              htmlFor="price-effective-from"
              hint="A partir de hoje — contratos fechados mantêm o preço congelado."
              error={touched && dateInvalid ? "A vigência não pode ser anterior a hoje." : null}
            >
              <Input
                id="price-effective-from"
                type="date"
                min={today}
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                onBlur={() => setTouched(true)}
                disabled={pending}
                aria-invalid={touched && dateInvalid}
              />
            </Field>
            <Field
              label="Motivo (auditado)"
              htmlFor="price-motivo"
              hint="Mín. 10 caracteres — registrado em auditoria."
              error={motivoInvalid ? "Motivo curto — mín. 10 caracteres." : null}
            >
              <Textarea
                id="price-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                onBlur={() => setTouched(true)}
                disabled={pending}
                placeholder="Ex.: Reajuste anual da tabela de preços"
                aria-invalid={motivoInvalid}
              />
            </Field>
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
                loadingLabel="Aplicando…"
                disabled={!valid || pending}
                title={
                  pending
                    ? "Aplicando…"
                    : !valid
                      ? "Preencha valor válido, vigência a partir de hoje e motivo com mín. 10 caracteres"
                      : "Aplicar novo preço ao plano"
                }
              >
                Aplicar novo preço
              </Button>
            </div>
          </form>
        )}
      </RequirePerm>
    </Dialog>
  );
}
