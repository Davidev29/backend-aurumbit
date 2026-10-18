/** @type {import('next').NextConfig} */
const path = require("path");

// Fase 6: headers de segurança do terminal administrativo.
// - CSP: `script-src 'unsafe-inline'` é exigência de hidratação do Next 14 sem
//   nonce-middleware (TODO: nonce por request p/ remover o 'unsafe-inline').
//   Em DEV o webpack/React Refresh exige ainda `'unsafe-eval'` — sem ele o
//   `main-app.js` morre com EvalError e a hidratação nunca acontece (menu
//   travado, rotas mortas). Produção segue sem 'unsafe-eval'.
//   Todo o resto é restritivo (`frame-ancestors 'none'`, `object-src 'none'`).
// - Cookies de sessão continuam httpOnly + Secure (prod) + SameSite=Lax
//   (ver `app/api/auth/*/route.ts`); claims de UI (`aurum_claims`) é espelho
//   legível SEM segredo — autorização real é sempre do backend (403).
const isDev = process.env.NODE_ENV === "development";
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

/** Raiz do monorepo — tracing root do standalone (T4). */
const REPO_ROOT = path.join(__dirname, "../..");

const nextConfig = {
  reactStrictMode: true,
  // Standalone só fora do Windows: o trace-copy do Next cria symlinks e o
  // build local no Windows (sem privilégio de symlink) falha com EPERM.
  // No Linux (Docker/CI) o standalone é gerado normalmente para o runner.
  // Override: FORCE_STANDALONE=1 força standalone em qualquer plataforma.
  // T4: tracing root no RAIZ do monorepo. O Next 14.2 lê
  // `experimental.outputFileTracingRoot` (o top-level existe no schema mas o
  // 14.2 ignora; mantido p/ o Next 15). Sem valor explícito o Next usa o
  // lockfile mais próximo — o `apps/admin/package-lock.json` legado (removido
  // no T4) forçava raiz = apps/admin e o runner não embarcava o
  // `@aurum-bit/contracts` (workspace:*), quebrando o require em runtime.
  ...(process.platform !== "win32" || process.env.FORCE_STANDALONE === "1"
    ? {
        output: "standalone",
        experimental: { outputFileTracingRoot: REPO_ROOT },
        outputFileTracingRoot: REPO_ROOT,
      }
    : {}),
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

module.exports = nextConfig;
