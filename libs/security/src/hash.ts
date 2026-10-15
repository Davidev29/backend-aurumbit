import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Hash — Fase 2 (completo).
 * - Senhas: `argon2id` com parâmetros explícitos (OWASP: 19 MiB, t=2, p=1).
 *   Sem o pacote `argon2` (optionalDependency), lança erro explícito em vez
 *   de cair em SHA — nunca armazenar senha com hash rápido.
 * - Licenças (PROJECT §2): `sha256Hex` p/ `key_hash` (busca UNIQUE),
 *   nunca plaintext no DB.
 * - IP/device (PROJECT §4): `hmacHex` com segredo rotativo via env/KMS.
 */

export async function hashPassword(plaintext: string): Promise<string> {
  const argon2 = await loadArgon2();
  if (!argon2) {
    throw new Error(
      "argon2 indisponível: instale a optionalDependency 'argon2'. Senhas nunca usam SHA.",
    );
  }
  return argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  const argon2 = await loadArgon2();
  if (!argon2) throw new Error("argon2 indisponível: instale a optionalDependency 'argon2'.");
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}

type Argon2Like = {
  argon2id: number;
  hash(s: string, opts?: unknown): Promise<string>;
  verify(h: string, s: string): Promise<boolean>;
};

let argon2Cache: Argon2Like | null | undefined;
async function loadArgon2(): Promise<Argon2Like | null> {
  if (argon2Cache !== undefined) return argon2Cache;
  try {
    // @ts-ignore optionalDependency — pode estar ausente (skeleton Fase 1); erro ou não, segue sem argon2
    const mod = await import("argon2");
    argon2Cache = (mod.default ?? mod) as Argon2Like;
  } catch {
    argon2Cache = null;
  }
  return argon2Cache;
}

/** SHA-256 hex — APENAS p/ `key_hash` de licença (índice UNIQUE) e fingerprints. NUNCA p/ senha. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** HMAC-SHA256 hex — `ip_hash` (salt 90d) e `device_hash` (secret rotativo). Segredo via env/KMS, nunca hardcoded. */
export function hmacHex(secret: string, input: string): string {
  if (!secret) throw new Error("hmacHex: segredo vazio — forneça via env/KMS.");
  return createHmac("sha256", secret).update(input, "utf8").digest("hex");
}

export function safeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Hash DEV-ONLY p/ seed/smoke Fase 1 (NÃO usar em produção nem p/ senha real).
 * Marcado no prefixo para o gitleaks/CI nunca confundir com credencial.
 */
export function devOnlyHash(input: string): string {
  return `dev-only$${sha256Hex(input)}`;
}
