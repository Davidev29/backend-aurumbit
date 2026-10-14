import { StaleBanner } from "./StaleBanner";

/**
 * @deprecated Prefira `StaleBanner` (Fase 6 — inclui `asOf` em pt-BR/TZ).
 * Mantido como alias para compatibilidade.
 */
export function StaleState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return <StaleBanner message={message} onRetry={onRetry} />;
}
