import { Badge } from "@/components/ui/Badge";
import type { Role } from "@/lib/types";

const TONE_BY_ROLE: Record<Role, "accent" | "info" | "warn" | "neutral"> = {
  OWNER: "accent",
  ADMIN: "info",
  FINANCE: "warn",
  MEMBER: "neutral",
};

/** Distintivo de papel (Membership OWNER/ADMIN/FINANCE/MEMBER — sempre caixa alta). */
export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone={TONE_BY_ROLE[role]}>
      <span className="font-mono uppercase">{role}</span>
    </Badge>
  );
}
