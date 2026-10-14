import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { GoldIcon } from "@/components/ui/GoldIcon";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * Estado vazio elegante: GoldIcon grande + título + descrição + ação.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center text-center py-10 px-6", className)}>
      <GoldIcon icon={icon} size="lg" variant="soft" />
      <h3 className="mt-4 font-display font-semibold text-headline text-text1">{title}</h3>
      {description && <div className="mt-1.5 max-w-md text-body text-text2">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
