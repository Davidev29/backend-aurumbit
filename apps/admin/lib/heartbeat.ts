/**
 * Heartbeat do Admin (REQUIREMENTS §4: pulso 60s / window 5min; offline = sem atividade).
 *
 * Limiares da UI (Fase 3):
 * - online (verde): atividade < 2min
 * - idle (âmbar): atividade < 15min
 * - offline (cinza): >= 15min ou timestamp inválido
 */

export type HeartbeatStatus = "online" | "idle" | "offline";

const TWO_MIN_MS = 2 * 60_000;
const FIFTEEN_MIN_MS = 15 * 60_000;

export function heartbeatStatus(lastActivityIso: string, nowMs: number = Date.now()): HeartbeatStatus {
  const t = new Date(lastActivityIso).getTime();
  if (Number.isNaN(t)) return "offline";
  const diff = nowMs - t;
  if (diff < 0) return "online";
  if (diff < TWO_MIN_MS) return "online";
  if (diff < FIFTEEN_MIN_MS) return "idle";
  return "offline";
}

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** Distância relativa em pt-BR ("há 3 minutos"). Nunca lança. */
export function formatHeartbeatRelative(lastActivityIso: string, nowMs: number = Date.now()): string {
  const t = new Date(lastActivityIso).getTime();
  if (Number.isNaN(t)) return "desconhecida";
  const diffSec = Math.round((t - nowMs) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 10) return "agora mesmo";
  if (abs < 60) return rtf.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
  return rtf.format(Math.round(diffHour / 24), "day");
}

export const HEARTBEAT_LABEL: Record<HeartbeatStatus, string> = {
  online: "online",
  idle: "ausente",
  offline: "offline",
};
