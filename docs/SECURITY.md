# Segurança — Aurum Bit (Fase 6, endurecimento)

Postura: só endurecer, sem negócio novo. Base normativa: `PROJECT.md` §§2–4,
`docs/LGPD.md`. Este documento consolida o inventário verificável da Fase 6
(cada item tem teste ou grep reproduzível).

## 1. Segredos — varredura e KMS TODOs

Varredura automatizada: `apps/api/src/security-secrets.spec.ts` (roda no `jest`).
Padrões: `AKIA…`, `sk-live/sk-test-…`, PEM private key, `xox…`, `ghp_…`,
`AIza…`, `re_…`; mais ausência de imports geo-IP server-side
(`maxmind`/`geoip`). Resultado na Fase 6: **0 ocorrências** no código-fonte
(`apps/api/src`, `apps/admin/{app,lib,components,stores,middleware}`,
`libs/*/src`). `.env.example` contém só `changeme`/localhost (não é segredo).

Segredos vivem em ambiente; o inventário abaixo vira KMS/secret-manager:

| # | Segredo | Hoje | TODO (KMS/rotativo) |
|---|---|---|---|
| K1 | `AUTH_JWT_SECRET`/`JWT_SECRET` (HS256) | env | Migrar p/ RS256 com chave privada em KMS/HSM; rotação com `kid` + janela de aceitação (ver `crypto.ts` TODO(KMS)) |
| K2 | `MFA_ENC_KEY` (segredo TOTP em repouso) | env (derivado c/ `deriveEncKey`) | Envelope encryption: DEK por identidade, KEK no KMS; rotação de KEK versionada |
| K3 | `key_enc` de licença (AES-256-GCM, envelope) | mestra em arquivo (`LICENSE_MASTER_KEY_PATH`, 0600, 64 hex) + anterior opcional (`LICENSE_MASTER_KEY_PREVIOUS_PATH`); DEK de 32B por chave | Re-cifra sob demanda até `v2.v1.*` zerar; depois KMS (`GenerateDataKey`); re-emissão auditada mantém trilha |
| K4 | Salt `ip_hash` (HMAC, rotação 90d — LGPD) | env | Salt versionado no KMS/secret-manager; rotação invalida hashes antigos (purge natural) |
| K5 | Secret `device_hash` rotativo | env (`deviceSecret()`) | Mesmo padrão K4; app continua enviando só `app_instance_id` aleatório |
| K6 | `ASAAS_API_KEY` / `ASAAS_WEBHOOK_SECRET` | env, sandbox-first | Secret-manager com rotação no dashboard Asaas; nunca em log (redact cobre `authorization`) |
| K7 | `RESEND_API_KEY` | env | Idem K6; idempotência por `eventId` já evita reenvio em rotação |
| K8 | `argon2` (hash de senha) | optionalDependency + fallback scrypt | Produção exige `argon2` instalado (`argon2id` 19MiB/t=2/p=1); CI deve falhar sem ele em imagem prod |

### K3 — envelope `v2` + rotação da mestra

Formato em `key_enc` (`apps/api/src/modules/licensing/license-keys.ts`):
`v2.<masterVer>.<encDEK b64>.<iv b64>.<ct b64>.<tag b64>` — DEK de 32B
aleatória por chave, cifrada (AES-256-GCM) pela mestra; `masterVer` =
`sha256(path)[:8]` (`v1` p/ a mestra inicial no caminho default).
`decrypt` de `v2.*` tenta a mestra **atual e depois a anterior**
(dual-decrypt); legado `v1.<iv>.<ct>.<tag>` ainda abre via
`LICENSE_KEY_ENC_KEY` (compat dev). Sem segredo: `encrypt` → `null`
(reveal 409), `decrypt` → throw. Arquivo da mestra fora de 0600/64hex =
ignorado (fail-closed).

Rotação (sem downtime de reveal):

1. Gere a mestra nova (64 hex, `chmod 600`) e aponte
   `LICENSE_MASTER_KEY_PATH` p/ ela; ponha a antiga em
   `LICENSE_MASTER_KEY_PREVIOUS_PATH` (a nova etiqueta `sha8`, a antiga
   segue `v1`).
2. Re-cifre sob demanda (cada `decrypt`+`encrypt` no fluxo normal migra
   a linha p/ a mestra nova); conte o restante legado:
   `SELECT count(*) FROM licensing.licenses WHERE key_enc LIKE 'v2.v1.%'`
   (DB único `aurumbit`, schema `licensing`).
3. Com count `v2.v1.*` = 0, remova `LICENSE_MASTER_KEY_PREVIOUS_PATH`
   e zere o arquivo da mestra antiga (`shred -u`); confirme
   `decrypt` de uma amostra + `reveal` sem 409.

## 2. Headers HTTP

API (`apps/api/src/common/http/security.ts`, aplicado em `main.ts`):

| Header | Valor | Nota |
|---|---|---|
| `Content-Security-Policy` | `default-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; frame-src 'none'` | API não renderiza conteúdo — nada executável |
| `X-Frame-Options` | `DENY` | anti-clickjacking |
| `Cross-Origin-Opener/Resource-Policy` | `same-origin` | |
| `Cross-Origin-Embedder-Policy` | ativo | |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | efetivo atrás de TLS (deploy) |
| `X-Content-Type-Options` | `nosniff` | |
| `Referrer-Policy` | `no-referrer` | |
| `X-Powered-By` | ausente | removido pelo helmet |

Admin (`apps/admin/next.config.js → headers()`): CSP pragmática do Next 14
(`script-src 'self' 'unsafe-inline'` — exigência de hidratação sem
nonce-middleware; **TODO**: nonce por request p/ remover o `unsafe-inline`),
`style-src 'self' 'unsafe-inline'`, `img/font 'self' data:`, `connect-src 'self'`,
`frame-ancestors 'none'`, `object-src 'none'`; mais `X-Frame-Options: DENY`,
`nosniff`, `Referrer-Policy: no-referrer`,
`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`,
HSTS 1a.

Teste: `apps/api/src/security-headers.spec.ts` (headers presentes via
express+supertest; CORS fail-closed; CSRF same-origin).

## 3. CORS + CSRF

- CORS fail-closed (`parseAllowlist`): sem `CORS_ORIGINS` → `[]` (deny all
  cross-origin; same-origin/curl/SDK não usam CORS). `"*"` é **ignorado** salvo
  fora de produção COM `ALLOW_CORS_WILDCARD=1` (com `credentials: true` o
  curinga é inválido nos navegadores de todo modo). Boot sem origens loga warn.
- CSRF: API é Bearer-first; o único fluxo com cookie (`POST /v1/auth/refresh`
  via `ab_refresh`, `SameSite=Lax`) exige request same-origin
  (`isSameOriginRequest` em `modules/auth/csrf.ts` — compara `Origin`/`Referer`
  com `Host`/`X-Forwarded-Host`; sem os headers = cliente não-navegador,
  permitido). Origem cruzada via cookie → `403 FORBIDDEN_ORIGIN`.

## 4. Cookies

| Cookie | httpOnly | Secure | SameSite | Observação |
|---|---|---|---|---|
| `ab_refresh` (API) | sim | sim em prod | `Lax` | `path=/v1/auth`, 30d; CSRF §3 |
| `aurum_session` (BFF admin) | sim | sim em prod | `Lax` | 8h; stub até backend real |
| `aurum_claims` (BFF admin) | **não** | sim em prod | `Lax` | espelho legível p/ gate de UI; SEM segredo — autorização real é o backend (403). TODO: claims assinadas |

## 5. Auditoria append-only + masking

- Superfície: `AuditService` expõe só `emit/list/listByEntity` (sem
  update/delete — assertado em `audit-security.spec.ts`); schema
  `prisma/audit` comenta a proibição (só INSERT+SELECT; retenção 5a).
- Metadata por allowlist (`sanitizeAuditMetadata`): `keyMasked`,
  `device_hash`, `tokenVersion`, `reason`, `months`, `template`, `eventId`,
  `actorId`, `orgId`, `amountCents`, `kind`, `premisesHash`, `horizonDays`.
  E-mail/CPF/chave crua/`key_hash`/`key_enc`/IP cru/`appInstanceId`/tokens
  nunca entram (teste dedicado).
- Emits verificados (Fase 6): `licensing-flow` (só `keyMasked`+`device_hash`),
  `devices.service` (`device_hash`+`ip_hint` mascarado), `finance-flow`
  (ator/org/valores operacionais), `auth.service` (`emailMasked`;
  `verificationToken`/`recoveryToken` raw trafegam no outbox **só** como
  segredo de uso único p/ o consumo do e-mail — nunca em log; fila com TTL e
  purge de 30d), `customers.service` (`cnpjLast4`, ids opacos),
  `communications` (`recipientMasked`, `keyMasked`).
- Logs: pino `redact` (`libs/observability/logger.ts`) + `redactObject`
  (`libs/security/masking.ts`): `maskEmail` (`d***@…`), `maskLicenseKey`
  (`AURUM-••••-••••-AB12`), `maskCpf`, `maskIp` (/24).

## 6. IP cru / geo (PROJECT §4, LGPD.md)

| Dado | Coluna(s) | Garantia |
|---|---|---|
| IP cru | nenhuma | variável local do request (`clientIp`) → só `maskIp24` (/24) e `hmacHex` HMAC; grep `ip:` nos schemas retorna só `ip_hint`/`ip_hash` |
| `ip_hint` | `license_devices.ip_hint` | /24 mascarado (detecção) |
| `ip_hash` | `license_devices.ip_hash` | HMAC c/ salt 90d (K4) |
| Geo-IP | — | **sem lookup server-side** (teste: 0 imports geoip/maxmind). `country` (2 letras, ISO) é **declarado pelo app** no DTO, avaliado **em memória** por `detectCloneSuspect` (função pura). O estado antifraude retido é só o código de 2 letras (`last_country` + `cloned_evidence`, últimos 5 sightings) — sinal de `impossible-travel`, não localização do usuário; sem cidade/lat-long/GPS em nenhuma coluna |
| UI | — | exibe no máximo cidade aproximada quando já presente no evento de risco, com aviso de imprecisão (admin atual: sem exibição de geo) |

## 7. GDPR — endpoints e ordem canônica

| Domínio | Export | Anonymize | 409 |
|---|---|---|---|
| `customers` | `GET /v1/customers/gdpr/export` (perfil+member
...[truncated 1351 chars]