"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ApiClientError } from "@/lib/api/client";
import { useCan } from "@/lib/auth/permissions";
import { revealLicense } from "@/lib/licenses";

const TOOLTIP =
  "Requer permissão license.read (+ MFA de admin no backend). " +
  "POST /v1/licenses/:id/reveal — rate-limit 10/h, gera AuditEvent license.reveal. Sem endpoint bulk.";

/**
 * Chave sempre mascarada (PROJECT §2: `AURUM-••••-••••-AB12`).
 * O plaintext só aparece após revelação auditada e nunca é logado.
 */
export function LicenseKeyMasked({
  licenseId,
  keyMasked,
}: {
  licenseId: string;
  keyMasked: string;
}) {
  const canReveal = useCan("license.read");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReveal() {
    setPending(true);
    setError(null);
    try {
      const res = await revealLicense(licenseId);
      setRevealed(res.key);
      // Oculta o plaintext após 60s (higiene de tela; auditoria permanece no backend).
      window.setTimeout(() => setRevealed(null), 60_000);
    } catch (e) {
      if (e instanceof ApiClientError && (e.status === 403 || e.status === 401)) {
        setError("Sem permissão para revelar (license.read).");
      } else if (e instanceof ApiClientError && e.code === "RATE_LIMITED") {
        setError("Limite de revelações excedido (10/h). Tente mais tarde.");
      } else {
        setError(e instanceof Error ? e.message : "Falha ao revelar a chave.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code
        className="font-mono tnum text-[0.85em] text-text1"
        aria-label={revealed ? "Chave revelada" : "Chave mascarada"}
      >
        {revealed ?? keyMasked}
      </code>
      {revealed ? (
        <Button variant="secondary" onClick={() => setRevealed(null)} aria-label="Ocultar chave">
          Ocultar
        </Button>
      ) : (
        <Button
          variant="secondary"
          onClick={handleReveal}
          disabled={!canReveal || pending}
          title={canReveal ? TOOLTIP : `${TOOLTIP} Você não tem license.read.`}
          aria-label="Revelar chave (auditado)"
        >
          {pending ? "Revelando…" : "Revelar"}
        </Button>
      )}
      {error && (
        <span className="inline-flex items-center gap-1 text-callout text-danger" role="alert">
          <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          {error}
        </span>
      )}
    </span>
  );
}
