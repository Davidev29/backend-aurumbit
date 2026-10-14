"use client";

import { useEffect, useState } from "react";
import { DEFAULT_TIMEZONE } from "@/lib/format";

/** Distintivo do fuso operacional (REQUIREMENTS §5: America/Sao_Paulo). */
export function TimezoneBadge() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const time = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DEFAULT_TIMEZONE,
  }).format(now);

  return (
    <span
      title={`Horário operacional (${DEFAULT_TIMEZONE})`}
      aria-label={`Horário operacional ${DEFAULT_TIMEZONE}, ${time}`}
      className="tnum inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-full border border-line2 px-3 text-caption text-text2"
    >
      {DEFAULT_TIMEZONE} · {time}
    </span>
  );
}
