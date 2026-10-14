"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Tabs + Segmented DS v1 (extraídos dos padrões `.tabs/.tab` e `.segmented`).
 * Superfícies opacas; `layoutId` SÓ p/ tab-underline (não usado aqui — borda).
 * Sem submenu, sem animação de width.
 */

/** Roving tabindex + setas/Home/End (mesmo molde da sidebar). */
function useRoving<T extends HTMLElement>() {
  const refs = useRef<Array<T | null>>([]);
  function onKeyDown(e: React.KeyboardEvent, index: number, count: number) {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % count;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + count) % count;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    if (next !== null) {
      e.preventDefault();
      refs.current[next]?.focus();
    }
  }
  return { refs, onKeyDown };
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const { refs, onKeyDown } = useRoving<HTMLButtonElement>();
  return (
    <div className="flex gap-1 border-b border-line1" role="tablist" aria-label={label}>
      {tabs.map((t, i) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i, tabs.length)}
            className={cn(
              "min-h-[44px] px-4 text-body font-semibold bg-transparent cursor-pointer border-b-2 focus-ring",
              active
                ? "text-text1 border-accent"
                : "text-text2 border-transparent hover:text-text1",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-base border border-line2 bg-bg1"
    >
      {options.map((o) => (
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

/** Painel de aba (par de `Tabs`). */
export function TabPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="tabpanel" aria-label={label}>
      {children}
    </div>
  );
}
