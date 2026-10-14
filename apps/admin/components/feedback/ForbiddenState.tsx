import Link from "next/link";
import { TriangleAlert } from "lucide-react";

export interface ForbiddenStateProps {
  requiredPerm?: string;
}

/** 403 DS v1 (DS §9): título + permissão exigida em mono + Voltar. */
export function ForbiddenState({ requiredPerm }: ForbiddenStateProps) {
  return (
    <div className="feedback" role="alert">
      <p aria-hidden="true" className="m-0 mb-2 flex justify-center text-danger dark:text-[#ff9a9e]">
        <TriangleAlert size={24} strokeWidth={1.75} />
      </p>
      <h2>Acesso negado (403)</h2>
      <p>
        Você não tem permissão para ver este conteúdo.
        {requiredPerm && (
          <>
            {" "}
            Permissão necessária: <code className="mono">{requiredPerm}</code>.
          </>
        )}
      </p>
      <p>
        <Link href="/dashboard">Voltar ao painel</Link>
      </p>
    </div>
  );
}
