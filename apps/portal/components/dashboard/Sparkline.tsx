"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  strokeClassName?: string;
}

/**
 * Sparkline decorativa em SVG puro (sem libs).
 * Normaliza os pontos para width/height; área com fill translúcido.
 */
export function Sparkline({
  data,
  width = 104,
  height = 30,
  className,
  strokeClassName,
}: SparklineProps) {
  const gradientId = useId();
  if (data.length === 0) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 3;
  const stepX = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;

  const points = data.map((v, i) => {
    const x = data.length > 1 ? pad + i * stepX : width / 2;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return { x, y };
  });

  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${pad},${height} ${line} ${(width - pad).toFixed(1)},${height}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("flex-shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} className="text-accent" />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn("text-accent", strokeClassName)}
      />
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={2.5}
          fill="currentColor"
          className="text-accent"
        />
      )}
    </svg>
  );
}
