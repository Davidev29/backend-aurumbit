import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui";
import { GoldIcon } from "@/components/ui/GoldIcon";
import { Sparkline } from "./Sparkline";
import { cn } from "@/lib/utils";

export type KpiChipTone = "ok" | "warn" | "danger" | "info" | "neutral" | "gold";

const chipStyles: Record<KpiChipTone, string> = {
  ok: "bg-ok-soft text-ok border-ok/30",
  warn: "bg-warn-soft text-warn border-warn/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  info: "bg-info-soft text-info border-info/30",
  neutral: "bg-bg2 text-text2 border-line2",
  gold: "bg-accent-soft text-accent border-line1",
};

export interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  chip?: { label: string; tone?: KpiChipTone };
  spark?: number[];
  iconVariant?: "gold" | "soft" | "outline";
}

/**
 * KPI padronizado do client area: GoldIcon + valor grande + chip + sparkline.
 */
export function KpiCard({
  icon,
  label,
  value,
  hint,
  chip,
  spark,
  iconVariant = "soft",
}: KpiCardProps) {
  return (
    <Card hover={false} className="overflow-hidden">
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <GoldIcon icon={icon} size="sm" variant={iconVariant} />
          {spark && spark.length > 0 && <Sparkline data={spark} />}
        </div>
        <p className="mt-3 text-caption text-text3">{label}</p>
        <p className="font-display font-bold text-kpi text-text1 leading-tight">{value}</p>
        <div className="mt-2 flex items-center gap-2 min-h-[22px]">
          {chip && (
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-full text-micro font-semibold border",
                chipStyles[chip.tone ?? "neutral"]
              )}
            >
              {chip.label}
            </span>
          )}
          {hint && <span className="text-caption text-text3 truncate">{hint}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
