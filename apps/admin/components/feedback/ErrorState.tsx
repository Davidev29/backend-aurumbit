"use client";

import { CircleX } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface ErrorStateProps {
  message?: string;
  /** Retry com `nonce++` na página (força refetch; nunca stub silencioso). */
  onRetry?: () => void;
}

/** Erro ancorado DS v1 (DS §9): `role=alert` + `Tentar novamente`. Sem toast flutuante. */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="feedback" role="alert">
      <p aria-hidden="true" className="m-0 mb-2 flex justify-center text-danger dark:text-[#ff9a9e]">
        <CircleX size={24} strokeWidth={1.75} />
      </p>
      <h2>Ocorreu um erro</h2>
      <p>{message ?? "Não foi possível carregar os dados. Tente novamente."}</p>
      {onRetry && (
        <Button type="button" variant="secondary" onClick={onRetry} title="Tentar carregar novamente">
          Tentar novamente
        </Button>
      )}
    </div>
  );
}
