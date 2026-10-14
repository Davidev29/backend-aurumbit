// Normalização de e-mail: NFKC + lowercase (+trim defensivo).
// Deve ser aplicada em todo write-path antes de persistir/comparar.
export function normalizeEmail(raw: string): string {
  return raw.normalize('NFKC').toLowerCase().trim();
}
