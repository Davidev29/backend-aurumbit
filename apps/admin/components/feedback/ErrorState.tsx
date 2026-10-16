"use client";

import { CircleX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toUserError } from "@/lib/errors";

export interface ErrorStateProps {
  message?: string;
  /**
   * Erro bruto (preferido): traduzido por `toUserError` em título instrutivo
   * + orientação do que fazer. Aceita `ApiClientError`, `Error` ou string —
   * por isso as páginas podem passar o `catch` sem formatar antes.
   */
  error?: unknown;
  /** Retry com `nonce++` na página (força refetch; nunca stub silencioso). */
  onRetry?: () => void;
}

/**
 * Erro ancorado DS v1 (DS §9): `role=alert` + título instrutivo (nunca o
 * genérico "Ocorreu um erro" quando há tradução) + `Tentar novamente`.
 * Sem toast flutuante (o estado persiste na página).
 */
export function ErrorState({ message, error, onRetry }: ErrorStateProps) {
  const u = toUserError(error ?? message ?? "Não foi possível carregar os dados.");
  const body = message && error ? message : u.body;
  return (
    <div className="feedback" role="alert">
      <p aria-hidden="true" className="m-0 mb-2 flex justify-center text-danger dark:text-[#ff9a9e]">
        <CircleX size={24} strokeWidth={1.75} />
      </p>
      <h2>{u.title}</h2>
      <p>{body}</p>
      {onRetry && (
        <Button type="button" variant="secondary" onClick={onRetry} title="Tentar carregar novamente">
          Tentar novamente
        </Button>
      )}
    </div>
  );
}
