"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GoldIconProps {
  icon: LucideIcon;
  size?: "sm" | "md" | "lg";
  variant?: "gold" | "soft" | "outline";
  className?: string;
  iconClassName?: string;
}

/**
 * Tile de ícone elegante padrão do Portal — container dourado + ícone lucide.
 * Use em cards, passos, KPIs e empty states para consistência visual.
 */
export function GoldIcon({
  icon: Icon,
  size = "md",
  variant = "soft",
  className,
  iconClassName,
}: GoldIconProps) {
  const sizes = {
    sm: "w-10 h-10 rounded-base",
    md: "w-12 h-12 rounded-base",
    lg: "w-14 h-14 rounded-card",
  };

  const variants = {
    gold: "bg-gradient-gold text-on-gold border-0 shadow-glow-sm",
    soft: "bg-accent-soft text-accent border border-line1",
    outline: "bg-transparent text-accent border border-line1",
  };

  const iconSizes = {
    sm: "w-5 h-5",
    md: "w-6 h-6",
    lg: "w-7 h-7",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center flex-shrink-0",
        sizes[size],
        variants[variant],
        className
      )}
      aria-hidden="true"
    >
      <Icon className={cn(iconSizes[size], iconClassName)} />
    </div>
  );
}
