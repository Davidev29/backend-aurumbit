/**
 * Reconciliação billing × Asaas (Fase 4, PROJECT.md §5).
 * Puro (sem Nest/PG/fetch): testável em unit.
 * - hourly: pendentes <7d; daily: 03:00 America/Sao_Paulo, janela 30d.
 * - Evento sintético `RECONCILIATION` (`recon:<id>:<data>`) pelo MESMO
 *   pipeline (fila `billing.webhook.apply`, `jobId = eventId`).
 * - Divergência valor/estado → alerta + métrica `billing.recon.*`.
 * (Espelha `reconEventId`/`paymentTargetForAsaasEvent` do billing core —
 *  duplicado aqui p/ build hermético durante o refactor paralelo do
 *  core; TODO convergir p/ import único quando o core estabilizar.)
 */

export const HOURLY_WINDOW_DAYS = 7;
export const DAILY_WINDOW_DAYS = 30;

/** Agendamento canônico (cron usa estes valores). */
export const RECONCILE_SCHEDULE = {
  hourly: '0 * * * *',
  daily: '0 3 * * *',
  timezone: 'America/Sao_Paulo',
} as const;

/** `recon:<id>:<data>` — mesmo pipeline (PROJECT.md §5). */
export function reconEventId(paymentExternalId: string, day: string): string {
  return `recon:${paymentExternalId}:${day}`;
}

export function isReconEvent(eventId: string): boolean {
  return eventId.startsWith('recon:');
}

/** Dia UTC `YYYY-MM-DD` (sufixo do eventId sintético). */
export function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Corte da janela (`now - days`), ISO. */
export function windowCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Normaliza status bruto Asaas → estado local de pagamento. Desconhecido → null. */
export function normalizeAsaasStatus(
  status: string,
): 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REFUNDED' | null {
  switch (status) {
    case 'PENDING':
      return 'PENDING';
    case 'RECEIVED':
    case 'CONFIRMED':
      return 'CONFIRMED';
    case 'OVERDUE':
      return 'FAILED'; // alinhado ao core: PAYMENT_OVERDUE → FAILED
    case 'REFUNDED':
      return 'REFUNDED';
    default:
      return null;
  }
}

export interface PaymentPair {
  localStatus: string;
  localAmountCents: number;
  remoteStatus: string;
  remoteAmountCents: number;
}

export interface CompareResult {
  match: boolean;
  divergences: string[];
}

/**
 * Compara `externalId → status/valor`. Fora de ordem: terminal local
 * (CONFIRMED/REFUNDED) nunca regride — remoto antigo vira divergência
 * (alerta), não transição.
 */
export function comparePayment(pair: PaymentPair): CompareResult {
  const divergences: string[] = [];
  const remote = normalizeAsaasStatus(pair.remoteStatus);
  if (!remote) divergences.push(`status-remoto-desconhecido:${pair.remoteStatus}`);
  else if (remote !== pair.localStatus) {
    const terminal = pair.localStatus === 'CONFIRMED' || pair.localStatus === 'REFUNDED';
    divergences.push(
      terminal
        ? `remoto-antigo:${pair.remoteStatus}-vs-local-terminal:${pair.localStatus}`
        : `estado:${pair.localStatus}-vs-${remote}`,
    );
  }
  if (pair.localAmountCents !== pair.remoteAmountCents) {
    divergences.push(`valor:${pair.localAmountCents}-vs-${pair.remoteAmountCents}`);
  }
  return { match: divergences.length === 0, divergences };
}

/**
 * ms até as próximas 03:00 em America/Sao_Paulo (sempre (0, 24h]).
 * Puro via `Intl` (sem dep de timezone).
 */
export function msUntilNextDaily3hSP(now: Date): number {
  const offset = spWallOffsetMs(now);
  const nowSpWall = now.getTime() + offset;
  const wall = new Date(nowSpWall); // campos UTC == parede-SP
  const sinceMidnightMs =
    (wall.getUTCHours() * 3600 + wall.getUTCMinutes() * 60 + wall.getUTCSeconds()) * 1000 +
    wall.getUTCMilliseconds();
  const dayStartSpWall = nowSpWall - sinceMidnightMs;
  let targetSpWall = dayStartSpWall + 3 * 3600 * 1000;
  if (targetSpWall <= nowSpWall) targetSpWall += 24 * 3600 * 1000;
  return targetSpWall - nowSpWall;
}

/** Offset SP (ms a SOMAR ao UTC p/ obter parede-SP), arredondado ao minuto. */
function spWallOffsetMs(now: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const wallAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  const truncated = Math.floor(now.getTime() / 60000) * 60000;
  return wallAsUtc - truncated;
}
