/**
 * Store dev do arquivamento (só quando `API_INTERNAL_URL` não está configurado).
 * Mesmo padrão de `localExtra` em `app/api/support/conversations/[id]/messages/route.ts`:
 * estado em memória no nível do módulo — o `GET ?archived=true` e o `PATCH {archived}`
 * precisam enxergar o mesmo conjunto (rotas diferentes, processo único em dev).
 * Com upstream, o Nest é a fonte e isto nunca é usado.
 */
const archivedAtById = new Map<string, string>();

export function devArchiveSet(id: string, archived: boolean): string | null {
  if (archived) {
    const at = new Date().toISOString();
    archivedAtById.set(id, at);
    return at;
  }
  archivedAtById.delete(id);
  return null;
}

export function devArchivedAt(id: string): string | null {
  return archivedAtById.get(id) ?? null;
}
