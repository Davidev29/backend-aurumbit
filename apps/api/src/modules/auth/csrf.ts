// Defesa CSRF p/ fluxos que aceitam cookie httpOnly (Fase 6).
//
// Postura: a API é Bearer-first; o único fluxo que lê cookie é o refresh
// (`ab_refresh`, SameSite=Lax). Lax já bloqueia envio do cookie em POST
// cross-site na maioria dos navegadores; esta checagem same-origin fecha a
// lacuna restante (navegador antigo/sem Lax + top-level GET com side-effect —
// que não temos, mas a defesa fica explícita e testada).
//
// Regra: se o request traz `Origin` (ou só `Referer`), o host deve coincidir
// com o Host do request (considerando `X-Forwarded-Host` atrás de proxy).
// Sem nenhum dos dois headers (curl/SDK, app nativo) → permite (cliente usa
// o token no corpo; CSRF é ameaça exclusiva de navegador).

export interface OriginCheckInput {
  headers?: Record<string, unknown>;
  host?: string;
}

function header(headers: Record<string, unknown> | undefined, name: string): string | null {
  if (!headers) return null;
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** `true` quando o request é same-origin ou não é navegável (sem Origin/Referer). */
export function isSameOriginRequest(input: OriginCheckInput): boolean {
  const headers = input.headers ?? {};
  const origin = header(headers, 'origin');
  const referer = header(headers, 'referer');
  if (!origin && !referer) return true; // cliente não-navegador (curl/SDK/app)
  const expected = (input.host ?? header(headers, 'host') ?? '').toLowerCase();
  if (expected === '') return false; // header presente mas sem Host p/ comparar → nega
  if (origin && hostOf(origin) !== expected) return false;
  if (!origin && referer && hostOf(referer) !== expected) return false;
  return true;
}
