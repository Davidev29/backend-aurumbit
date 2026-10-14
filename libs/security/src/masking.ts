/**
 * maskPII — Fase 1, sem negócio.
 * Regras (PROJECT §§2/4, LGPD.md):
 * - E-mail: mantém 1º char + domínio p/ suporte (`d***@example.com`).
 * - Chave de licença: `AURUM-••••-••••-AB12` (só last4 visível).
 * - CPF: `***.***.***-**` (ou `123.***.***-**` quando suporte precisar do prefixo).
 * - IP: máscara /24 (`192.168.1.0/24`); raw nunca persiste.
 * - Genérico: `redactObject` p/ logs/filas (nunca vazar PII em Outbox/BullMQ).
 */

const BULLET = "•";

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const user = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (user.length <= 1) return `*\@${domain}`;
  return `${user[0]}***@${domain}`;
}

/** `AURUM-XXXX-XXXX-AB12` → `AURUM-••••-••••-AB12`. Entrada fora do padrão vira máscara total. */
export function maskLicenseKey(key: string): string {
  const m = key.match(/^([A-Z]+)-([A-Za-z0-9]+)-([A-Za-z0-9]+)-([A-Za-z0-9]{4})$/);
  if (!m) return "••••";
  const [, tag, , , last4] = m;
  return `${tag}-${BULLET.repeat(4)}-${BULLET.repeat(4)}-${last4}`;
}

export function maskCpf(cpf: string, keepPrefix = false): string {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return "***.***.***-**";
  if (keepPrefix) return `${digits.slice(0, 3)}.***.***-**`;
  return "***.***.***-**";
}

export function maskCnpj(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return "**.***/***/****-**";
  return `${digits.slice(0, 2)}.***.***/****-**`;
}

/** IPv4 → /24 mascarado. IPv6 → /48 aproximado. Entrada inválida → `0.0.0.0/32`. */
export function maskIp(ip: string): string {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.every((n) => n >= 0 && n <= 255)) return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
    return "0.0.0.0/32";
  }
  if (ip.includes(":")) {
    const head = ip.split(":").slice(0, 3).join(":");
    return `${head}::/48`;
  }
  return "0.0.0.0/32";
}

const SENSITIVE_KEYS = new Set([
  "password",
  "currentpassword",
  "newpassword",
  "authorization",
  "cookie",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "licensekey",
  "key_enc",
  "cpf",
  "cnpj",
  "secret",
  "privatekey",
]);

/** Clona `obj` redigindo valores de chaves sensíveis (case-insensitive). */
export function redactObject<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactObject(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redactObject(v);
  }
  return out as T;
}
