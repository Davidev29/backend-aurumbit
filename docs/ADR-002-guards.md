# ADR-002 — Cadeia de guards compartilhada (`common/guards`)

- Status: **aceita** (Fase 2 — guards + shared, sem negócio)
- Data: 2026-10-10
- Vincula: `PROJECT.md` §§2–4, `REQUIREMENTS.md` §§1–2, `docs/LGPD.md`

## Contexto

 Nove domínios compartilham as mesmas exigências de borda: JWT com
 `iss`/`aud`/`exp`/`jti`/`sid`, sessão ACTIVE, step-up MFA, e-mail
 verificado, roles staff e escopo por organização. Sem cadeia única,
 cada módulo reinventaria a ordem — e ordem errada (ex. checar role
 antes de validar assinatura) é vulnerabilidade.

## Decisão

 Cadeia única em `apps/api/src/common/guards`, registrada como
 `APP_GUARD` **nesta ordem** (ver `guards.module.ts`; importado primeiro
 no `AppModule`):

| # | Guard | Gatilho | Falha |
|---|-------|---------|-------|
| 1 | `JwtAuthGuard` | sempre (exceto `@Public()`) | 401 `UNAUTHORIZED`/`TOKEN_EXPIRED`/`TOKEN_REJECTED` |
| 2 | `SessionGuard` | `request.user` presente | 401 `SESSION_NOT_FOUND`/`MISMATCH`/`REVOKED`/`EXPIRED` |
| 3 | `MfaGuard` | `@RequireMfa()` | 403 `MFA_REQUIRED` |
| 4 | `VerifiedEmailGuard` | autenticado (exceto `@AllowUnverified()`) | 403 `EMAIL_NOT_VERIFIED` |
| 5 | `RolesGuard` | `@Roles(...)` | 403 `FORBIDDEN` |
| 6 | `CustomerScopeGuard` | `@CustomerScope()` | 400 `ORG_REQUIRED` / 403 `ORG_FORBIDDEN` |

 Pontos-chave:

- **JWT HS256 sem dependência externa** (`common/auth/jwt.service.ts`,
  `node:crypto`): valida assinatura + `iss`/`aud`/`exp`/`nbf`/`iat` +
  presença de `sub`/`sid`/`jti`. `JWT_SECRET` fail-fast (default de
  teste recusado em produção). Payload sem PII (só IDs opacos).
- **Sessão/membership via portas** (`SESSION_LOOKUP`,
  `MEMBERSHIP_LOOKUP`): o schema `prisma/auth` Fase 2 ainda não tem
  `AuthSession` (só `UserIdentity`), então o provider default é
  em-memória p/ testes; a Fase 3 pluga o adaptador Prisma
  (`auth_db` / `customers_db`) **sem tocar nos guards**. Default-deny.
- **Seletividade**: guards 3–6 só agem com o marcador da rota; rotas
  públicas pulam tudo (health `live`/`ready` são `@Public()` — probes
  não autenticam).
- **Coexistência Fase 2**: `modules/auth/guards.ts` contém guards
  wired ao `AuthService`/Prisma (claims
  `identityId/sessionId/familyId/mfa`). A convergência (claims únicas
  + adaptadores Prisma nas portas) ocorre na Fase 3; até lá, a cadeia
  `common/guards` é a referência p/ novas rotas.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| `@nestjs/jwt` + `passport` | Dependências e superfície novas p/ o que `node:crypto` resolve em ~100 linhas auditáveis; troca avaliada na Fase 6 se precisar de RS256/JWKS |
| Checagem de sessão dentro do `JwtAuthGuard` | Mistura autenticação (token) com estado (sessão); impede reuse/teste isolado e quebra a ordem documentada |
| Roles com prefixo `STAFF_*` validado no guard | Acoplaria convenção de hoje ao mecanismo; o guard compara strings e a convenção vive em docs + `STAFF_ROLES` |

## Consequências

- (+) Ordem auditável num só lugar; e2e `auth.guards` trava regressão.
- (+) Domínios não tocam em crypto/sessão — só marcadores (`@Roles`, `@CustomerScope`).
- (−) Toda rota autenticada exige sessão ACTIVE (by design; clientes sem
  sessão usam rotas `@Public()` como login/refresh).
- (LGPD) Erros nunca vazam PII; `sid`/`jti` opacos; `ip_hash`/`device_hash`
  seguem `libs/security` + `LGPD.md` (raw só em memória).
