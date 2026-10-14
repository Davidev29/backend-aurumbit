"use client";

export type FinanceQuickFilter = "todas" | "efetivadas" | "aguardando" | "atrasadas";

export const QUICK_OPTIONS: Array<{ id: FinanceQuickFilter; label: string; hint: string }> = [
  { id: "todas", label: "Todas", hint: "Sem recorte de situação" },
  { id: "efetivadas", label: "Efetivadas", hint: "Pagas / recebidas" },
  { id: "aguardando", label: "Aguardando", hint: "Previstas + pendentes" },
  { id: "atrasadas", label: "Atrasadas", hint: "Vencidas" },
];

/** Mapeia o recorte rápido para os estados reais de cada ledger. */
export function matchesQuick(status: string, quick: FinanceQuickFilter, settled: string): boolean {
  if (quick === "todas") return true;
  if (quick === "efetivadas") return status === settled;
  if (quick === "aguardando") return status === "PREVISTO" || status === "PENDENTE";
  return status === "VENCIDO";
}

/**
 * Filtro rápido de situação (segmented control acessível).
 * Despesas: efetivadas=PAGO · Receitas: efetivadas=RECEBIDO ·
 * aguardando=PREVISTO+PENDENTE · atrasadas=VENCIDO.
 */
export function QuickFilterChips({
  value,
  onChange,
  labelledBy,
}: {
  value: FinanceQuickFilter;
  onChange: (v: FinanceQuickFilter) => void;
  labelledBy: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="flex flex-wrap gap-2"
    >
      {QUICK_OPTIONS.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.hint}
            onClick={() => onChange(o.id)}
            className={
              active
                ? "min-h-[44px] rounded-full border border-accent bg-accentsoft px-4 text-body font-semibold text-text1 focus-ring"
                : "min-h-[44px] rounded-full border border-line2 bg-bg2 px-4 text-body font-normal text-text2 hover:text-text1 focus-ring"
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
