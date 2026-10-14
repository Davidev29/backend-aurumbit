"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

export type LogoSize = "sm" | "md" | "lg";
export type LogoVariant = "full" | "mark";

export interface LogoProps {
  size?: LogoSize;
  variant?: LogoVariant;
  priority?: boolean;
  className?: string;
}

// Dimensões intrínsecas de /logo-aurumbit.png (PNG otimizado da marca).
const FULL_WIDTH = 1416;
const FULL_HEIGHT = 429;

const FULL_HEIGHTS: Record<LogoSize, number> = {
  sm: 24,
  md: 32,
  lg: 40,
};

const MARK_SIZES: Record<LogoSize, number> = {
  sm: 28,
  md: 36,
  lg: 44,
};

export function Logo({ size = "md", variant = "full", priority = false, className }: LogoProps) {
  if (variant === "mark") {
    const side = MARK_SIZES[size];
    return (
      <Image
        src="/icon-192.png"
        alt="AurumBit"
        width={side}
        height={side}
        priority={priority}
        sizes={`${side}px`}
        className={cn("rounded-sm", className)}
      />
    );
  }

  const height = FULL_HEIGHTS[size];
  const width = Math.round((height * FULL_WIDTH) / FULL_HEIGHT);
  return (
    <Image
      src="/logo-aurumbit.png"
      alt="AurumBit"
      width={width}
      height={height}
      priority={priority}
      sizes={`${width}px`}
      className={className}
    />
  );
}
