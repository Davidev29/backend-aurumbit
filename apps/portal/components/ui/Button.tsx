"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md" | "lg" | "xl";
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center gap-2 font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out " +
      "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 " +
      "disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none " +
      "active:scale-[0.98]";

    const variants = {
      primary:
        "btn-primary bg-gradient-gold shadow-glow-sm hover:shadow-glow border-0",
      ghost:
        "btn-ghost bg-transparent border border-line2 text-text1 hover:bg-bg2 hover:border-accent/50 hover:text-accent",
      outline:
        "btn-outline bg-transparent border-2 border-accent text-accent hover:bg-accent/10",
      danger:
        "btn bg-danger text-danger-ink hover:bg-danger/90 shadow-[0_0_20px_rgba(248,113,113,0.2)] border-0",
    };

    const sizes = {
      sm: "min-h-[44px] px-3 py-1.5 text-caption rounded-sm gap-1.5",
      md: "min-h-[44px] px-4 py-2 text-body rounded-base gap-2",
      lg: "min-h-[52px] px-6 py-3 text-headline rounded-base gap-2",
      xl: "min-h-[56px] px-8 py-3.5 text-title-page rounded-base gap-2.5",
    };

    const widthClass = fullWidth ? "w-full" : "";

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], widthClass, variant === "primary" && "font-bold", className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <>
            <svg
              className="animate-spin h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Carregando...</span>
          </>
        ) : (
          <>
            {leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";