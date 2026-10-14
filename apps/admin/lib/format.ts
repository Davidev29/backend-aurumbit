/**
 * Formatação pt-BR + fuso padrão America/Sao_Paulo (REQUIREMENTS §5).
 * UI usa Intl nativo — sem dependência externa.
 */

export const DEFAULT_TIMEZONE = "America/Sao_Paulo" as const;
export const DEFAULT_LOCALE = "pt-BR" as const;

const brl = new Intl.NumberFormat(DEFAULT_LOCALE, {
  style: "currency",
  currency: "BRL",
});

/** Formata centavos ou reais? Recebe valor em reais. */
export function formatBRL(value: number): string {
  return brl.format(value);
}

export function formatDateTimeInTZ(
  iso: string | Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(d);
}

export function formatDateInTZ(iso: string | Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    dateStyle: "short",
    timeZone,
  }).format(d);
}
