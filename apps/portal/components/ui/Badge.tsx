"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps {
  children: ReactNode;
  variant?: "gold" | "neutral" | "success" | "danger" | "info" | "outline";
  size?: "sm" | "md" | "lg";
  className?: string;
  dot?: boolean;
}

export function Badge({
  children,
  variant = "neutral",
  size = "md",
  className,
  dot = false,
}: BadgeProps) {
  const variants = {
    gold: "badge-gold",
    neutral: "badge-neutral",
    success: "badge bg-ok-soft text-ok border-ok/30",
    danger: "badge bg-danger-soft text-danger border-danger/30",
    info: "badge bg-info-soft text-info border-info/30",
    outline: "badge bg-transparent border-line2 text-text2",
  };

  const sizes = {
    sm: "px-2 py-0.5 text-micro gap-0.5",
    md: "px-2.5 py-0.5 text-caption gap-1",
    lg: "px-3 py-1 text-body gap-1.5",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold rounded-full",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            variant === "gold" && "bg-accent",
            variant === "neutral" && "bg-text3",
            variant === "success" && "bg-ok",
            variant === "danger" && "bg-danger",
            variant === "info" && "bg-info",
            variant === "outline" && "bg-text3"
          )}
        />
      )}
      {children}
    </span>
  );
}