# AurumBit Portal — Landing + Área do Cliente

Next.js 14 App Router (porta 3002 em dev) — porta de entrada premium da AurumBit
e área logada do cliente.

## Rotas

| Rota | Acesso | O quê |
|---|---|---|
| `/` | pública | Landing (hero + vitrine + propósito + como funciona + CTA) |
| `/dashboard` | protegida | Visão geral (KPIs, resumo, upsell) |
| `/dashboard/sistemas` | protegida | Sistemas liberados, copiar licença, revelar chave auditada, downloads |
| `/dashboard/faturas` | protegida | Faturas com filtro, PDF, pagar |
| `/dashboard/comprar` | protegida | Catálogo + seleção de plano + checkout (stub) |
| `/dashboard/perfil` | protegida | Dados pessoais + segurança |
| `/api/products` | pública | BFF → `GET /v1/products` (revalidate 60s) ou stub |
| `/api/auth/*` | pública | BFF login/register/me/logout (cookies httpOnly) |
| `/api/me/*` | protegida | BFF licenças/faturas/assinaturas/perfil + reveal auditado |

## Auth

JWT em cookie httpOnly `aurum_portal_session` (`Secure` em prod, `SameSite=Lax`) —
nunca em `localStorage`. Middleware redireciona `/dashboard` sem sessão para `/?login=1`,
que abre o `AuthModal` automaticamente. Sem `API_INTERNAL_URL`, o BFF responde stubs
idênticos em shape aos do Nest.

## Dev

```bash
pnpm --dir apps/portal install
pnpm --dir apps/portal dev     # http://localhost:3002
pnpm --dir apps/portal build
pnpm --dir apps/portal start   # http://localhost:3002
```

## Env

Ver `.env.example`. `API_INTERNAL_URL` aponta ao Nest (`http://localhost:3000`);
ausente = modo stub (vitrine + login `cliente@aurum.test` / qualquer senha funcionam).
