"use client";

import { cn } from "@/lib/cn";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  label?: string;
  className?: string;
}

/**
 * Skeleton DS v1: shimmer 1.2s (`animate-shimmer`), `reduced-motion` desliga.
 * Contêiner com `aria-busy`; QR do MFA usa placeholder `200×200`.
 */
export function Skeleton({ width = "100%", height = "1rem", label = "Carregando…", className }: SkeletonProps) {
  return (
    <div
      className={cn("skeleton motion-safe:animate-shimmer motion-reduce:animate-none", className)}
      style={{ width, height }}
      role="status"
      aria-label={label}
    />
  );
}

export function SkeletonTable({ rows = 5, label = "Carregando tabela" }: { rows?: number; label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height="2.2rem" />
      ))}
    </div>
  );
}
