// Profundidade DLQ no readiness (Fase 6, puro/testável).
// Decisão: DLQ NUNCA derruba o readiness sozinha (warn, não 503).
// Racional: DLQ pressionada é sintoma operacional (consumidor lento/poison),
// não indisponibilidade do processo — derrubar readiness removeria o pod
// do LB e impediria o próprio replay manual. O envelope expõe `dlq` com
// `warn: true` quando há pendentes, para alerta sem flap de probes.
// (A alternativa — 503 se `audit.dlq > 0` — foi descartada pelo motivo acima;
// não existe fila `audit.dlq` dedicada: auditoria é append-only, sem retry.)

export interface DlqReadyStatus {
  /** Total pendente (não replayadas) em todas as DLQs. */
  pending: number;
  /** Profundidade por fila. */
  perQueue: Record<string, number>;
  /** true quando há qualquer pendente (alerta, sem 503). */
  warn: boolean;
}

export function dlqReadyStatus(perQueue: Record<string, number> = {}): DlqReadyStatus {
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(perQueue)) {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    if (n > 0) clean[k] = n;
  }
  const pending = Object.values(clean).reduce((a, b) => a + b, 0);
  return { pending, perQueue: clean, warn: pending > 0 };
}
