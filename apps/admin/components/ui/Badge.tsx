"use client";

import type { ReactNode } from "react";
import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "ok" | "warn" | "danger" | "info" | "accent";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-bg2 text-text1 border-line2",
  ok: "bg-oksoft text-ok border-ok",
  warn: "bg-warnsoft text-warn border-warn",
  danger: "bg-dangersoft text-danger border-danger",
  info: "bg-infosoft text-info border-info",
  accent: "bg-accentsoft text-accent border-accent",
};

/** Ícone padrão por tom (DS §9: badge soft opaco + ícone — nunca só cor). */
const TONE_ICON: Partial<Record<BadgeTone, LucideIcon>> = {
  ok: CircleCheck,
  warn: TriangleAlert,
  danger: CircleX,
  info: Info,
  accent: CircleCheck,
};

/**
 * Badge DS v1: soft opaco + borda da mesma cor + ícone do tom.
 * Auto-ícone só quando o conteúdo é texto simples; passe `icon={false}`
 * p/ suprimir ou `icon={Outro}` p/ forçar (ex.: `GraceBadge` já tem o seu).
 * `state` gera `aria-label="Estado: X"` (pt-BR).
 */
export function Badge({
  tone = "neutral",
  children,
  className,
  icon,
  state,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  icon?: LucideIcon | false;
  /** Rótulo de estado pt-BR p/ leitores de tela (`Estado: X`). */
  state?: string;
}) {
  const AutoIcon = tone ? TONE_ICON[tone] : undefined;
  const showAuto = icon === undefined && typeof children === "string" && AutoIcon;
  const ForcedIcon = typeof icon === "function" ? icon : undefined;

  return (
    <span
      aria-label={state ? `Estado: ${state}` : undefined}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-micro border font-semibold",
        tones[tone],
        className,
      )}
    >
      {ForcedIcon && <ForcedIcon size={14} strokeWidth={1.75} aria-hidden="true" />}
      {showAuto && AutoIcon && <AutoIcon size={14} strokeWidth={1.75} aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * Dot de presença (DS §9): 8px + rótulo textual obrigatório.
 * Tons: `ok` online · `warn` idle/degradado · `neutral` offline.
 */
export function Dot({
  tone = "neutral",
  label,
  className,
}: {
  tone?: "ok" | "warn" | "danger" | "neutral";
  /** Rótulo textual — cor nunca é o único sinal. */
  label: string;
  className?: string;
}) {
  const dot =
    tone === "ok"
      ? "bg-ok"
      : tone === "warn"
        ? "bg-warn"
        : tone === "danger"
          ? "bg-danger"
          : "bg-line3";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden="true" className={cn("inline-block h-2 w-2 rounded-full", dot)} />
      <span>{label}</span>
    </span>
  );
}
