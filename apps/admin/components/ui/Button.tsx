"use client";

import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "destructive" | "ghost" | "icon";
type Size = "lg" | "md" | "sm";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accentink border border-accent font-semibold hover:brightness-110",
  secondary: "bg-bg2 text-text1 border border-line2 hover:border-line3",
  destructive: "bg-dangersoft text-danger border border-danger font-semibold hover:brightness-125",
  ghost: "bg-transparent text-text1 border border-line2 hover:border-line3",
  icon: "bg-bg2 text-text1 border border-line2 hover:border-line3 p-0",
};

const sizes: Record<Size, string> = {
  lg: "min-h-[48px] px-5 text-body",
  md: "min-h-[44px] px-4 text-body",
  sm: "min-h-[36px] px-3 text-callout",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /**
   * Estado de carregamento: trava o botão (`disabled` + `aria-busy`) e troca
   * o rótulo por `verbo + …` (ex.: `Revogando…`) sem trocar a largura
   * (`min-w` preservado, sem spinner substituindo o texto sozinho).
   */
  loading?: boolean;
  /** Rótulo exibido durante `loading` (verbo + `…`). */
  loadingLabel?: string;
};

/**
 * Botão DS v1 (DS §9). `sm` restrito a contextos densos.
 * Destrutivo sempre em 2 passos (o form cuida — ver `DestructiveForm`).
 * `whileTap .97` via `active:scale`; foco via `focus-ring`.
 *
 * Regra dura: todo `disabled` em ação com permissão carrega `title` com o
 * motivo (aviso em dev quando ausente).
 */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  loadingLabel,
  className,
  children,
  title,
  disabled,
  type,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  if (process.env.NODE_ENV !== "production" && isDisabled && !title && !props["aria-label"]) {
    // eslint-disable-next-line no-console
    console.warn("[Aurum DS] Button desabilitado sem `title` — informe o motivo (ex.: permissão exigida).");
  }

  return (
    <button
      type={type ?? "button"}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      title={title}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-base [font:inherit] cursor-pointer",
        "transition-transform duration-100 ease-out active:scale-[0.97]",
        "disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100",
        "focus-ring",
        variant === "icon" ? "w-11 h-11" : "w-auto",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 motion-safe:animate-spin motion-reduce:animate-none" />}
      {loading ? (loadingLabel ?? children) : children}
    </button>
  );
}
