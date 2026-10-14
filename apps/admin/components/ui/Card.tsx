"use client";

import { TriangleAlert } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * Card L1 DS v1 (DS §5): opaco `bg-1`, `shadow-1`, raio 14.
 * Sem sombra colorida (só anel de foco). Blur é privilégio do chrome.
 */
export function Card({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div aria-label={label} className={cn("rounded-card border border-line1 bg-bg1 shadow-1 p-5", className)}>
      {children}
    </div>
  );
}

/**
 * KpiCard DS v1: valor `1.6/700` mono + `tnum`, rótulo e hint `muted`.
 * KPI parcial é proibido sem aviso: passe `partial` (+ `teto`) e o card
 * exibe o aviso de teto em warn com ícone (nunca só cor).
 */
export function KpiCard({
  label,
  value,
  kind = "number",
  hint,
  partial,
  teto,
}: {
  label: string;
  value: number;
  kind?: "currency" | "number";
  hint?: string;
  /** Dado parcial/snapshot: exige aviso de teto. */
  partial?: boolean;
  /** Descrição do teto aplicado (ex.: `primeiros 1.000 registros`). */
  teto?: string;
}) {
  const display = kind === "currency" ? formatBRL(value) : value.toLocaleString("pt-BR");
  return (
    <Card>
      <p className="m-0 text-callout text-text2">{label}</p>
      <p className="m-0 mt-1 font-mono text-kpi tabular-nums text-text1">{display}</p>
      {partial && (
        <p className="m-0 mt-1 flex items-center gap-1.5 text-callout text-warn" role="note">
          <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          Dado parcial{teto ? ` — teto: ${teto}` : " — teto aplicado"}.
        </p>
      )}
      {hint && <p className="m-0 mt-1 text-callout text-text2">{hint}</p>}
    </Card>
  );
}
