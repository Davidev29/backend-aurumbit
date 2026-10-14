"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatDateTimeInTZ } from "@/lib/format";
import { HEARTBEAT_LABEL, formatHeartbeatRelative, heartbeatStatus } from "@/lib/heartbeat";
import type { HeartbeatStatus } from "@/lib/heartbeat";

const TONE: Record<HeartbeatStatus, "ok" | "warn" | "neutral"> = {
  online: "ok",
  idle: "warn",
  offline: "neutral",
};

const DOT: Record<HeartbeatStatus, string> = {
  online: "bg-ok",
  idle: "bg-warn",
  offline: "bg-line3",
};

/**
 * Heartbeat (REQUIREMENTS §4): verde <2min, âmbar <15min, cinza offline.
 * Exibe distância relativa + timestamp absoluto na TZ (REQUIREMENTS §5).
 */
export function HeartbeatDot({ lastActivity, timeZone }: { lastActivity: string; timeZone?: string }) {
  const [, setTick] = useState(0);

  // Reavalia o relativo a cada 30s sem refetch.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const status = heartbeatStatus(lastActivity);
  const relative = formatHeartbeatRelative(lastActivity);
  const absolute = formatDateTimeInTZ(lastActivity, timeZone);

  return (
    <span
      title={`Última atividade: ${absolute} (${relative})`}
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      <span aria-label={`status ${HEARTBEAT_LABEL[status]}`}>
        <Badge tone={TONE[status]}>
          <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${DOT[status]}`} />
          {HEARTBEAT_LABEL[status]}
        </Badge>
      </span>
      <span className="text-callout text-text2">
        · <time dateTime={lastActivity}>{relative}</time> ({absolute})
      </span>
    </span>
  );
}
