"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  leftElement?: ReactNode;
  rightElement?: ReactNode;
  /** `true` quando `rightElement` é interativo (ex.: botão mostrar senha). */
  rightInteractive?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      leftIcon,
      rightIcon,
      leftElement,
      rightElement,
      rightInteractive = false,
      className,
      id,
      disabled,
      required,
      ...props
    },
    ref
  ) => {
    const reactId = useId().replace(/:/g, "");
    const inputId = id || `input-${reactId}`;
    const errorId = error ? `${inputId}-error` : undefined;
    const hintId = hint ? `${inputId}-hint` : undefined;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="label">
            {label}
            {required && <span className="text-danger ml-1" aria-hidden="true">*</span>}
          </label>
        )}
        <div className="relative">
          {(leftIcon || leftElement) && (
            <div
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text3 pointer-events-none flex items-center"
              aria-hidden="true"
            >
              {leftElement || leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            required={required}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={cn(errorId, hintId)}
            className={cn(
              "input",
              leftIcon || leftElement ? "pl-10" : "",
              rightIcon || rightElement ? "pr-10" : "",
              error && "input-error",
              className
            )}
            {...props}
          />
          {(rightIcon || rightElement) && (
            <div
              className={cn(
                "absolute right-3 top-1/2 -translate-y-1/2 text-text3 flex items-center",
                !rightInteractive && "pointer-events-none"
              )}
              aria-hidden={!rightInteractive ? "true" : undefined}
            >
              {rightElement || rightIcon}
            </div>
          )}
        </div>
        {error && (
          <p id={errorId} className="error-text" role="alert">
            {error}
          </p>
        )}
        {hint && !error && <p id={hintId} className="text-caption text-text3 mt-1">{hint}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";