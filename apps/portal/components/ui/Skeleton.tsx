"use client";

import { cn } from "@/lib/utils";

export interface SkeletonProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular" | "card";
  width?: string | number;
  height?: string | number;
  lines?: number;
}

export function Skeleton({
  className,
  variant = "rectangular",
  width,
  height,
  lines = 1,
}: SkeletonProps) {
  if (variant === "text") {
    return (
      <div className={cn("space-y-2", className)} aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "skeleton h-4 rounded-base",
              i === lines - 1 && "w-3/4",
              "w-full"
            )}
            style={{ width: i === lines - 1 ? "75%" : "100%" }}
          />
        ))}
      </div>
    );
  }

  if (variant === "circular") {
    return (
      <div
        className={cn("skeleton rounded-full", className)}
        style={{
          width: width || "40px",
          height: height || "40px",
        }}
        aria-hidden="true"
      />
    );
  }

  if (variant === "card") {
    return (
      <div className={cn("space-y-4", className)} aria-hidden="true">
        <div className="skeleton aspect-video rounded-base w-full" />
        <div className="space-y-2">
          <div className="skeleton h-6 w-1/3 rounded-base" />
          <div className="skeleton h-4 w-full rounded-base" />
          <div className="skeleton h-4 w-2/3 rounded-base" />
        </div>
        <div className="skeleton h-10 w-1/4 rounded-base" />
      </div>
    );
  }

  return (
    <div
      className={cn("skeleton rounded-base", className)}
      style={{
        width: width || "100%",
        height: height || "1rem",
      }}
      aria-hidden="true"
    />
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="glass-card group p-0 overflow-hidden">
      <div className="aspect-video bg-bg2 relative overflow-hidden">
        <div className="absolute inset-0 skeleton" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg0/80 via-transparent to-transparent" />
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="skeleton h-5 w-20 rounded-full" />
          <div className="skeleton h-5 w-16 rounded-full" />
        </div>
        <div className="skeleton h-6 w-3/4 rounded-base" />
        <div className="skeleton h-4 w-full rounded-base" />
        <div className="flex flex-wrap gap-2">
          <div className="skeleton h-6 w-20 rounded-full" />
          <div className="skeleton h-6 w-24 rounded-full" />
        </div>
        <div className="skeleton h-10 w-full rounded-base mt-2" />
      </div>
    </div>
  );
}

export function SectionSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card p-6 space-y-2">
            <div className="skeleton h-4 w-1/3 rounded-base" />
            <div className="skeleton h-10 w-1/2 rounded-base" />
          </div>
        ))}
      </div>
      <div className="glass-card p-6">
        <div className="skeleton h-6 w-1/4 rounded-base mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="skeleton h-12 w-12 rounded-base" />
              <div className="flex-1 space-y-1">
                <div className="skeleton h-4 w-1/3 rounded-base" />
                <div className="skeleton h-3 w-1/2 rounded-base" />
              </div>
              <div className="skeleton h-8 w-20 rounded-base" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}