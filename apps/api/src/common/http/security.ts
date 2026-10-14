import helmet from 'helmet';

// Endurecimento HTTP da API (Fase 6). Módulo leve e sem imports Nest —
// importável em testes unitários sem bootar o AppModule (fail-fast de env).
// TODO(T5): mover CORS/pino para libs/observability (ver main.ts).

export function securityHelmetOptions(): Parameters<typeof helmet>[0] {
  // API JSON sem conteúdo renderizado: CSP restritiva (nada executável),
  // anti-clickjacking, HSTS, sem sniffing, sem referrer.
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    frameguard: { action: 'deny' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
  };
}

/**
 * Allowlist CORS fail-closed: sem `CORS_ORIGINS` explícita, nenhuma origem
 * cross-site é aceita (chamadas same-origin/curl/SDK não usam CORS e seguem
 * funcionando). `"*"` com `credentials: true` é inválido nos navegadores e
 * perigoso em produção — só honrado fora de prod COM opt-in explícito.
 */
export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw || raw.trim() === '') return [];
  const parts = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (parts.includes('*')) {
    if (process.env.NODE_ENV === 'production' || process.env.ALLOW_CORS_WILDCARD !== '1') {
      console.warn('[security] CORS_ORIGINS="*" ignorado (fail-closed; defina origens explícitas)');
      return parts.filter((p) => p !== '*');
    }
  }
  return parts;
}
