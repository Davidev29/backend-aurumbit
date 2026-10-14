"use client";

import { useId, useState, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Field + inputs DS v1 (DS §9): label 600 → input opaco 44px → hint → erro inline.
 * Ordem canônica travada; erro sempre com `role="alert"`.
 * Dinheiro/IDs/MFA: `mono` + `tnum`.
 */

const INPUT_BASE = cn(
  "w-full min-h-[44px] px-3 rounded-base font-inherit text-body text-text1",
  "bg-bg2 border border-line2 placeholder:text-text3",
  "focus-ring",
);

const MONO = "font-mono text-[0.85em] tnum";

/** Erro inline: `--danger` no light, `#ff9a9e` no dark (DS §3). */
const ERROR_TEXT = "text-danger dark:text-[#ff9a9e]";

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  const fallbackId = useId();
  const errorId = `${htmlFor ?? fallbackId}-error`;
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="block mb-1 font-semibold text-headline text-text1">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p className="mt-1 text-callout text-text2">{hint}</p>
      )}
      {error && (
        <p id={errorId} className={cn("mt-1 text-callout", ERROR_TEXT)} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({
  className,
  mono,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return <input className={cn(INPUT_BASE, mono && MONO, className)} {...props} />;
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} autoComplete={props.autoComplete ?? "current-password"} className={cn("pr-[3.2rem]", props.className)} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={show}
        title={show ? "Ocultar senha" : "Mostrar senha"}
        className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-base text-text2 hover:text-text1 focus-ring"
      >
        {show ? (
          <EyeOff size={20} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Eye size={20} strokeWidth={1.75} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

export function Textarea({
  className,
  rows = 3,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows}
      className={cn(INPUT_BASE, "py-2 resize-y", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  mono,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { mono?: boolean }) {
  return (
    <select className={cn(INPUT_BASE, "pr-3", mono && MONO, className)} {...props}>
      {children}
    </select>
  );
}

const CODE_LENGTH = 6;

/**
 * CodeInput MFA (DS §9): mono, filtra `\D`, aceita colar, auto-submit aos 6.
 * `onComplete` dispara exatamente uma vez por preenchimento válido.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = CODE_LENGTH,
  id = "mfa-code",
  autoFocus = false,
  disabled = false,
  label = "Código de 6 dígitos",
}: {
  value: string;
  onChange: (digits: string) => void;
  onComplete?: (digits: string) => void;
  length?: number;
  id?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, length);

  return (
    <Input
      id={id}
      mono
      aria-label={label}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder={"•".repeat(length)}
      required
      autoFocus={autoFocus}
      disabled={disabled}
      value={value}
      onChange={(e) => {
        const digits = onlyDigits(e.target.value);
        onChange(digits);
        if (digits.length === length) onComplete?.(digits);
      }}
      onPaste={(e) => {
        const text = e.clipboardData.getData("text");
        if (!text) return;
        e.preventDefault();
        const digits = onlyDigits(text);
        onChange(digits);
        if (digits.length === length) onComplete?.(digits);
      }}
      className="text-mfa-code text-center tracking-[0.3em]"
    />
  );
}
