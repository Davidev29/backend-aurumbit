"use client";

/** Chaves cujo valor é mascarado na UI (PII/segredo — PROJECT §4). */
const SENSITIVE = /(cpf|cnpj|card|secret|password|passwd|token|api[_-]?key|authorization)/i;

function maskValue(key: string, value: unknown): unknown {
  if (typeof value === "string" && SENSITIVE.test(key)) {
    return value.length <= 4 ? "••••" : `${value.slice(0, 2)}••••${value.slice(-2)}`;
  }
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) return value.map((v) => maskValue(key, v));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskValue(k, v);
    }
    return out;
  }
  return value;
}

/**
 * JSON mascarado p/ auditoria (Fase 4 — REQUIREMENTS §4: sem PII sensível).
 * O backend já mascara; esta camada re-mascaia por defesa em profundidade.
 */
export function MaskedJson({ data }: { data: unknown }) {
  const masked = maskValue("root", data);
  return (
    <pre
      className="overflow-x-auto rounded-base border border-line1 bg-bg2 p-3 font-mono tnum text-callout text-text1"
      tabIndex={0}
      aria-label="Metadados mascarados do evento"
    >
      {JSON.stringify(masked, null, 2)}
    </pre>
  );
}
