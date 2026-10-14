import { createHash } from 'node:crypto';

// Helpers de privacidade do domínio communications (PROJECT.md §§4/6).
// Cópias 1:1 de libs/security + libs/resend-adapter: apps/api compila com
// rootDir próprio e não importa os pacotes (mesmo padrão de
// `licensing/license-keys.ts`). Divergência intencional: nenhuma — espelhar.

/** SHA-256 hex — `recipientHash` (busca), nunca p/ senha. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Normaliza e-mail p/ hash/busca (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Hash do destinatário (persistido; o e-mail cru nunca persiste). */
export function recipientHash(email: string): string {
  return sha256Hex(normalizeEmail(email));
}

/** `d***@dominio` p/ suporte/logs (persistido em `recipientMasked`). */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const user = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (user.length <= 1) return `*@${domain}`;
  return `${user[0]}***@${domain}`;
}
