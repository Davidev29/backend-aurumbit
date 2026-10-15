/** @type {import('next').NextConfig} */
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
      "img-src 'self' data: https:",
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

const nextConfig = {
  reactStrictMode: true,
  // Standalone só fora do Windows: o trace-copy do Next cria symlinks e o
  // build local no Windows (sem privilégio de symlink) falha com EPERM.
  // No Linux (Docker/CI) o standalone é gerado normalmente para o runner.
  // Override: FORCE_STANDALONE=1 força standalone em qualquer plataforma.
  ...(process.platform !== "win32" || process.env.FORCE_STANDALONE === "1"
    ? { output: "standalone" }
    : {}),
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  images: {
    // Allowlist fechada (Fase 9, endurecimento do otimizador): galeria vem da
    // API e assets locais — nunca otimize URL remota arbitrária (SSRF/RCE via
    // otimizador; cf. .trivyignore). Novos hosts de imagem entram aqui.
    remotePatterns: [
      { protocol: "https", hostname: "aurumbit.com" },
      { protocol: "https", hostname: "api.aurumbit.com" },
      { protocol: "http", hostname: "localhost" },
    ],
  },
};

module.exports = nextConfig;