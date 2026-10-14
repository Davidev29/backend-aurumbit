"use client";

import { cn } from "@/lib/cn";
import type { Period } from "@/lib/types";

const OPTIONS: { value: Period; label: string }[] = [
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
  { value: "year", label: "Ano" },
];

interface PeriodFilterProps {
  value: Period;
  onChange: (p: Period) => void;
}

export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  return (
    <div
      role="group"
      aria-label="Período"
      className="inline-flex overflow-hidden rounded-base border border-line2 bg-bg1"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-[44px] px-4 text-body focus-ring",
            value === o.value ? "bg-bg2 font-semibold text-text1" : "text-text2 hover:text-text1",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
