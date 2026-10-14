import { Info } from "lucide-react";

export interface EmptyStateProps {
  title: string;
  message?: string;
  /** Ação de recuperação (padrão das páginas: `Limpar filtros` reseta filtros+paging). */
  action?: React.ReactNode;
}

/** Estado vazio DS v1 (DS §9): título sem jargão + próximo passo + ação. */
export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <div className="feedback">
      <p aria-hidden="true" className="m-0 mb-2 flex justify-center text-text2">
        <Info size={24} strokeWidth={1.75} />
      </p>
      <h2>{title}</h2>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}
