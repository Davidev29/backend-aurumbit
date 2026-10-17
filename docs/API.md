# API Aurum Bit — Guia de Integração e Referência (`v1`)

> **Público-alvo:** (a) os **programas gerenciados** (apps Win/Mac/Web/App, fora deste
> repo) que precisam ativar chave, vincular máquina e validar licença; (b) o BFF
> do portal/admin; (c) integrações server-to-server.
>
> **Fonte da verdade:** este documento descreve o que o **código faz hoje**. Cada
> afirmação tem origem rastreável no §12 (matriz de rastreabilidade). Onde código e
> documentação antiga divergem, vale o código — e a divergência está registrada no §14.
>
> Documentos relacionados: [`ACTIVATION.md`](./ACTIVATION.md) (contrato de ativação),
> [`produtos-offline.md`](./produtos-offline.md) (ciclo de vida de produto/licença),
> [`PROJECT.md`](../.planning/PROJECT.md) (decisões), [`ENDPOINTS-INVENTORY.md`](../.planning/ENDPOINTS-INVENTORY.md)
> (inventário bruto por leitura de código), [`ARCHITECTURE.md`](./ARCHITECTURE.md),
> [`openapi.yaml`](./openapi.yaml) (spec OpenAPI 3.1 da superfície de integração).

---

## 0. TL;DR para quem vai integrar um programa

```text
Base (dev):   http://localhost:3000          Base (prod): https://api.aurumbit.com
Prefixo de negócio: /v1     Exceções: /health/*  /metrics  /admin/queues  /webhooks/resend  /docs*

Fluxo mínimo do app instalado (modo chave, sem conta):
  1) POST /v1/licenses/activate-by-key        { key, app_instance_id, label?, ip? }
     → { licenseId, device_hash, offlineToken, off_exp, token_version, keyMasked, ... }
  2) guardar { licenseId, device_hash, offlineToken } de forma segura; relógio monotônico
  3) online:  POST /v1/licenses/{licenseId}/validate   { device_hash, ip?, country?, token_iat?, ctr? }
     → HTTP 200 SEMPRE; o corpo diz allow/deny (nunca tratar 200 como sucesso cego)
  4) offline: validar o JWT localmente até off_exp (teto 7d) — ver §10
  5) nunca derivar o device_hash no cliente (segredo é só do servidor)

Autenticação de programa: a "credencial" é o device_hash (HMAC server-side) +
device vinculado à licença. Rotas de app (`activate-by-key`, `validate`,
`offline-token`) são @Public e protegidas por rate-limit por IP.
Rotas administrativas exigem Bearer JWT (Usuário) ou x-internal-key (worker).
```

**As 5 regras que nunca mudam** (herdadas de `PROJECT.md` §1, refletidas no código):

1. **Sem cobrança, sem licença** — a licença nasce apenas em `PaymentConfirmed`.
2. **Re-entrega não duplica** — `eventId`/`Idempotency-Key` são chaves únicas.
3. **Fora de ordem não regride** — evento antigo não tira estado terminal.
4. **Offline tem teto** — `off_exp = min(iat + 7d, expires_at + 7d)`; graça de 3d vence mesmo offline.
5. **A API decide; a UI só reflete** — `check-access` é a autoridade, nunca o cliente.

---

## 1. Topologia e endereços

```text
Internet ──443──► Caddy (TLS + HSTS)
  ├── aurumbit.com        → 127.0.0.1:3002  Portal (Next, BFF fail-closed)
  ├── admin.aurumbit.com  → 127.0.0.1:3001  Admin  (Next, BFF httpOnly proxy)
  └── api.aurumbit.com    → 127.0.0.1:3000  API NestJS  ◄── programas gerenciados falam aqui
```

| Ambiente | Base URL | Observação |
|---|---|---|
| Local (Docker) | `http://localhost:3000` | `docker compose -f deploy/docker-compose.yml up` |
| Local (host) | `http://localhost:3000` | `PORT` default 3000 |
| Produção | `https://api.aurumbit.com` | Exige TLS; só `443` exposta na WAN |

**Prefixo global:** `/v1` (definido em `apps/api/src/main.ts` com `setGlobalPrefix`).
Rotas fora do prefixo, por decisão explícita:

| Rota | Por quê |
|---|---|
| `GET /health/live`, `GET /health/ready` | probes de K8s/CI (`curl -f`) |
| `GET /metrics` | scrape Prometheus (`http_requests_total`) |
| `GET /admin/queues` | Bull Board (stub) |
| `POST /webhooks/resend` | URL pública estável registrada no painel Resend |
| `GET /docs`, `/docs-json`, `/docs-yaml` | **Swagger UI** + spec bruta (ver §3.5); fora de produção por padrão |

**Versão da API:** `v1` (`API_VERSION` em `libs/contracts/src/index.ts`). A política de
evolução é *forward-compatible*: produtores só **adicionam** campos opcionais;
consumidores **ignoram** campos desconhecidos; nunca renomear/remover/estreitar.

---

## 2. Convenções de fio (não quebrar)

| Tema | Regra |
|---|---|
| Formato | JSON (`Content-Type: application/json`), exceto upload de imagem (`multipart/form-data`) e export CSV. |
| Nomenclatura no fio | **`snake_case`** nos campos de contrato do dispositivo (`device_hash`, `app_instance_id`, `token_iat`, `off_exp`); demais DTOs usam `camelCase`. As DTOs com `@Expose({ name })` convertem automaticamente (`device_hash` ↔ `deviceHash`). |
| Datas | ISO-8601 UTC (`2026-10-17T12:00:00.000Z`) ou epoch **segundos** onde o campo diz `*_exp`/`iat`/`ctr`. |
| Dinheiro | Inteiro em **centavos** (`priceCents`, `amountCents`, `unitPriceCents`) — nunca float. |
| IDs | Opacos (`uuid`/`cuid`). Referência cross-schema é `String` opaca (ADR-006) — nunca derive semântica deles. |
| Status persistido | minúsculo (`active`, `grace`, `suspended`, `revoked`, `expired`, `pending_payment`). |
| `reason` de decisão | MAIÚSCULO (`ALLOW`/`DENY`, `ACTIVE`, `GRACE`, `EXPIRED`, `DEVICE_BLOCKED`, `CLONE_SUSPECT`, `OFFLINE_EXPIRED`…) — é enum de contrato com o app. |
| Correlação | Envie `x-correlation-id` (UUID) em toda escrita; a API **ecoa** o valor no response header e no log. Ausente = a API gera `randomUUID()`. |
| Listas | Paginação por **cursor** (`Page<T>` = `{ data[], meta: { nextCursor, limit } }`) no admin; endpoints de licença retornam `{ items }`. |
| UTF-8 | Sempre. Mensagens de erro em pt-BR. |
| PII | Payload de erro/log nunca carrega e-mail, senha, CPF ou chave em claro. |

---

## 3. Como se conectar

### 3.1 TLS e rede

- **Produção:** somente `https://`. Caddy termina TLS, aplica HSTS
  (`max-age=31536000; includeSubDomains`) e redireciona `www → apex`.
- **Sem porta exposta na WAN:** `3000/3001/3002/5432/6379/6432` escutam em
  `127.0.0.1` (override `deploy/docker-compose.prod.yml`).

### 3.2 CORS é *fail-closed*

`main.ts` + `common/http/security.ts`: a allowlist vem de `CORS_ORIGINS`
(CSV). Sem a variável, **nenhuma origem cross-site é aceita**; `"*"` é
**ignorado** em produção (e só honrado fora de prod com `ALLOW_CORS_WILDCARD=1`).
Chamadas **não-navegador** (programa instalado, curl, SDK, BFF server-to-server)
não usam CORS e seguem funcionando normalmente.

> **Programas desktop:** não dependa de CORS. Faça requisições diretas de um
> processo nativo (ou de um servidor interno do app), não do `fetch` de uma
> página embutida em origem diferente.

### 3.3 Cabeçalhos HTTP — referência completa

| Cabeçalho | Direção | Obrigatório em | Semântica |
|---|---|---|---|
| `Authorization: Bearer <jwt>` | request | rotas de usuário (guard global) | JWT HS256, TTL 15 min, claims `sub`/`sid`/`jti` (ver §4.1) |
| `x-correlation-id` | request → response | toda escrita (recomendado) | rastreio ponta a ponta; ecoado |
| `Idempotency-Key` | request | **obrigatório** (≥8 chars) nas baixas financeiras (`mark-received`/`mark-paid`) e na automação (`expenses`, `receivables/auto`); opcional nos demais POSTs de billing/finance | replay retorna o recurso existente (§6); ausente/curta onde exigida ⇒ `400 IDEMPOTENCY_REQUIRED` |
| `x-internal-key` | request | rotas `internal/*` (worker→API) | igual a `INTERNAL_WEBHOOK_KEY`; ausente ⇒ **503 fail-closed** |
| `x-role: admin` | request | rotas admin "stub" | RBAC provisório (ver §4.4 e §14) |
| `x-service-token` | request | admin de licensing | alternativa a `x-role` quando `LICENSE_INTERNAL_TOKEN` existe |
| `x-mfa: verified` | request | `reveal` por admin humano | step-up MFA (senão `403 MFA_REQUIRED`) |
| `x-scope: license.read` | request | `reveal` sem ser admin | concessão explícita |
| `x-finance-read: <orgId>` | request | finance leitura (não-admin) | concessão `finance.read` escopada (§4.5) |
| `x-org-id: <orgId>` | request | rotas `@CustomerScope`, finance | escopo de organização; ausente ⇒ `400 ORG_REQUIRED` / `403` |
| `x-actor-id` / `x-subject-id` | request | reveal/auditoria | identifica o ator na trilha e no rate-limit |
| `x-forwarded-for` | request | atrás de proxy | primeiro IP da cadeia é usado como IP do cliente |
| `RateLimit-Policy` | response | rotas limitadas | ex. `login;w=60` |
| `Retry-After` | response | `429` | segundos até poder tentar de novo |
| `x-correlation-id` | response | todas | eco do request |

### 3.4 Exemplo de "conexão mínima" (programa → API)

```bash
# Health (sem auth, fora do /v1)
curl -s http://localhost:3000/health/live
# → 200 {"status":"ok"}

# Ativação por chave (pública, rate-limited)
curl -s -X POST "$API/v1/licenses/activate-by-key" \
  -H 'content-type: application/json' \
  -H "x-correlation-id: $(uuidgen)" \
  -d '{"key":"AURUM-7Q2M-9XKD-PL4T","app_instance_id":"e0c1…-uuid-da-instalacao","label":"PC do caixa","ip":"203.0.113.10"}'
```

### 3.5 Swagger UI e a spec servida pela própria API

A API **serve** o [`openapi.yaml`](./openapi.yaml) na própria instância — a mesma
spec versionada neste repo, sem geração por reflexão (uma fonte só, sem drift):

| Rota | O quê |
|---|---|
| `GET /docs` | Swagger UI interativo (`Try it out` habilitado) |
| `GET /docs-json` | spec em JSON (`application/json`) |
| `GET /docs-yaml` | spec em YAML (fonte da verdade, servida como está) |

Configuração (ver `apps/api/src/common/openapi/swagger.ts` e `.env.example`):

| Variável | Default | Efeito |
|---|---|---|
| `SWAGGER_ENABLED` | ligado fora de `production` | `true/false/1/0`; em **produção** o default é **desligado** (fail-closed) |
| `SWAGGER_PATH` | `docs` | prefixo do UI e da spec (`{path}`, `{path}-json`, `{path}-yaml`) |
| `OPENAPI_SPEC_PATH` | — | caminho absoluto/relativo da spec; sobrepõe a busca automática por `docs/openapi.yaml` |

> **CSP:** o Swagger UI roda sob CSP própria — o resto da API segue
> `default-src 'none'`, e `/docs*` recebe uma política que permite o bundle
> (`script-src 'self' 'unsafe-inline'`). É o único ponto que serve HTML/JS.
>
> **Sem documento duplicado:** editar `docs/openapi.yaml` e re-deployar basta; o
> `/docs` reflete a mudança (não há spec "gerada" a sincronizar).

---

## 4. Autenticação e autorização

Há **quatro modos** de credencial. Escolha pelo tipo de chamador — nunca misture.

### 4.1 Usuário final — Bearer JWT (15 min) + sessão

- Emitido por `POST /v1/auth/login` (ou `POST /v1/auth/refresh`).
- Algoritmo **HS256** (`JwtService`), com validação de `iss`, `aud`, `exp`,
  `nbf`/`iat` (skew 30 s) e presença de `sub`/`sid`/`jti`.
- Claims: `sub` (identityId), `sid` (session id, precisa estar `ACTIVE`),
  `jti`, `iss` (default `aurum-bit`), `aud` (default `aurum-clients`),
  `iat`, `exp`, `amr` (`["pwd"]` ou `["pwd","mfa"]`), `email_verified`,
  `roles`, `token_version`.
- **Sem PII** no payload (LGPD): nunca e-mail/CPF.
- `refreshToken` é rotativo: reuso revoga a **família** inteira (`REUSE_DETECTED`).
  Pode vir no corpo (`{ refreshToken }`) ou em cookie httpOnly `ab_refresh`
  (`path=/v1/auth`, `SameSite=Lax`, `Secure` em prod). Via cookie, o refresh
  exige **same-origin** (CSRF).

**Cadeia de guards global** (ordem de avaliação, `common/guards/guards.module.ts`):

```text
1. JwtAuthGuard          → 401 TOKEN_EXPIRED | TOKEN_REJECTED | UNAUTHORIZED
2. SessionGuard          → 401 se o `sid` não está ACTIVE
3. MfaGuard              → 403 MFA_REQUIRED (só rotas @RequireMfa; hoje sem uso em rota)
4. VerifiedEmailGuard    → 403 EMAIL_NOT_VERIFIED (só rotas marcadas)
5. RolesGuard            → 403 (só rotas @Roles)
6. CustomerScopeGuard    → 400 ORG_REQUIRED / 403 ORG_FORBIDDEN (só rotas @CustomerScope)
```

Rotas marcadas `@Public()` pulam a cadeia (webhooks, health, app instalado).

### 4.2 Programa gerenciado — identificação por dispositivo

O app instalado **não tem JWT de usuário** no modo chave. A credencial é o
**`device_hash`**: um HMAC-SHA256 (hex de 64) derivado **no servidor** a partir de
`(segredo, licenseId, app_instance_id)`. O segredo nunca sai do servidor — o
cliente **nunca** calcula o HMAC (ver `resolveDeviceHash` em
`devices.service.ts`; rastreabilidade no §12).

```text
device_hash = HMAC-SHA256(LICENSING_DEVICE_SECRET, licenseId || app_instance_id).hex64
```

Rotas de programa são `@Public()` e protegidas apenas por **rate-limit por IP**
(preset `devicePoll`, 120/min) e pela posse do `device_hash`:

| Rota | Papel |
|---|---|
| `POST /v1/licenses/activate-by-key` | 1ª vez: chave → vincula device + emite offline-token |
| `POST /v1/licenses/{id}/validate` | validação online periódica (sempre 200 no corpo) |
| `GET /v1/licenses/{id}/offline-token?device_hash=` | reemite o JWT offline (exige online) |

> **Modo A (recomendado, com conta):** o app chama o **BFF do portal**
> `POST /api/me/licenses/activate` com cookie de sessão; o portal resolve
> e-mail → licenças (`GET /v1/licenses?mine=1`), vincula e emite o token.
> O app nunca vê JWT de usuário — só o resultado final (`ActivationResult`).

### 4.3 Worker → API — `x-internal-key`

Workers (BullMQ) **nunca escrevem no Postgres direto**; aplicam mudanças via
endpoints internos da API com `x-internal-key: <INTERNAL_WEBHOOK_KEY>`
(comparação timing-safe). **Sem a chave configurada ⇒ 503 fail-closed** (nunca
"aberto por engano"). Onde `INTERNAL_PROJECTION_KEY` é lido, é o
`InternalProjectionKeyGuard` das projeções.

### 4.4 Admin (RBAC provisório / *stub*)

Enquanto o RBAC real não substitui os stubs (ver §14), as rotas administrativas
aceitam:

- `x-role: admin` — habilita escrita de licença, catálogo, bonus, financeiro.
- `x-service-token` — alternativa de máquina para licensing (`LICENSE_INTERNAL_TOKEN`).
- `x-mfa: verified` — exigido para **`reveal`** quando o chamador é admin humano.
- `x-scope: license.read` — `reveal` para não-admin.

> Trate essas rotas como **superfície interna**: o BFF admin injeta os headers,
> o usuário final nunca os define.

### 4.5 `finance.read` é concessão explícita e escopada

`FinanceReadGuard` (default-deny): resolve o escopo por `x-org-id` →
`?orgId`/`?org_id` → body `orgId`. Sem `x-role: admin` nem `x-finance-read: <orgId>`
casando com o escopo ⇒ **403**. Frontend pode esconder a tela; o backend nega de
verdade.

---

## 5. Erros — envelope, status e códigos

O envelope de erro é `ApiError` (`libs/contracts/src/index.ts`):

```json
{ "code": "DEVICE_LIMIT", "message": "limite de 3 devices atingido", "details": { "maxDevices": true } }
```

| HTTP | `code` típico | Quando |
|---|---|---|
| 400 | `BAD_REQUEST`, `ORG_REQUIRED`, `IDEMPOTENCY_REQUIRED`, `VALIDATION_ERROR` | corpo/query inválido (ValidationPipe `whitelist+forbidNonWhitelisted`) |
| 401 | `UNAUTHORIZED`, `TOKEN_EXPIRED`, `TOKEN_REJECTED`, `INVALID_CREDENTIALS`, `INVALID_TOKEN`, `REUSE_DETECTED`, `SESSION_NOT_FOUND` | credencial ausente/inválida |
| 403 | `FORBIDDEN`, `MFA_REQUIRED`, `ORG_FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `LICENSE_INACTIVE`, `LICENSE_REVOKED`, `LICENSE_SUSPENDED`, `DEVICE_BLOCKED`, `CLONE_SUSPECT`, `EXPIRED` | autenticado, mas sem direito |
| 404 | `NOT_FOUND`, `LICENSE_NOT_FOUND`, `UNKNOWN_DEVICE`, `KEY_INVALID`, `ACCOUNT_NO_LICENSE` | recurso não existe (alguns de propósito **genéricos** — anti-enumeração) |
| 409 | `DEVICE_LIMIT`, `DEVICE_CONFLICT`, `ALREADY_ROTATED`, `INVALID_ROTATE`, `CONFLICT`, `LIFETIME_NO_RENEW`, `DEVICE_NOT_ACTIVE` | conflito de estado |
| 422 | `UNPROCESSABLE` | transição de estado ilegal (`assertTransition`) |
| 423 | `ACCOUNT_LOCKED` | lockout de login (`Retry-After` sugerido) |
| 429 | `RATE_LIMITED` | excedeu preset; vem `Retry-After` e `RateLimit-Policy` |
| 500 | `INTERNAL` | inesperado (sem detalhe sensível) |
| 502 | `UPSTREAM_MISSING` / `UPSTREAM_UNAVAILABLE` | **BFF** sem backend (fail-closed, nunca mock silencioso) |
| 503 | `SERVICE_UNAVAILABLE` | `internal/*` sem chave configurada; `health/ready` com PG/Redis down |

### 5.1 Dois casos em que **HTTP 200 não é sucesso**

1. `POST /v1/licenses/{id}/validate` — sempre `200`; o **corpo** diz
   `{ allow: false, reason: "…" }`. Isso evita *retry-storm* do app instalado.
2. Webhooks — sempre `200` (`{ received, duplicate }`); o processamento é
   assíncrono e idempotente.

Códigos de contrato estáveis (`ERROR_CODES`): `BAD_REQUEST`, `UNAUTHORIZED`,
`FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `UNPROCESSABLE`, `RATE_LIMITED`,
`INTERNAL`, `SERVICE_UNAVAILABLE`, `EXPIRED`, `OFFLINE_EXPIRED`,
`LICENSE_DEGRADED`, `DEVICE_LIMIT`.

---

## 6. Idempotência

Três mecanismos, escolhidos pelo tipo de operação:

| Mecanismo | Onde | Comportamento de replay |
|---|---|---|
| `Idempotency-Key` (header) | **obrigatório** (≥8 chars) nas baixas `mark-received`/`mark-paid` e na automação (`expenses`, `receivables/auto`); opcional nos demais POSTs de billing/finance | retorna o recurso existente (200/201), sem novo efeito |
| `eventId` único (claim-first) | `internal/issue-from-payment`, `finance/internal/sync`, webhooks | `{ duplicate: true }` (ou `{ applied: false }`) — nunca 409 |
| Chave natural (UNIQUE) | `orderId` do checkout, `(provider, externalId)` do receipt | segunda entrega retorna o mesmo resultado |

Regras para o cliente:

- Gere uma `Idempotency-Key` por **tentativa lógica** (ex. `order-<uuid>`), não
  por retry. Retry de rede deve reusar a mesma chave.
- `Idempotency-Key` **obrigatória** (mín. 8 chars) nas baixas `mark-received`/`mark-paid`
  e na automação (`expenses`, `receivables/auto`); ausente/curta ⇒
  `400 IDEMPOTENCY_REQUIRED` (`Idempotency-Key obrigatória (mín. 8 chars).`), sem
  baixa e sem query. Nos demais POSTs de billing/finance a chave é opcional.
- Replay do mesmo `Idempotency-Key` (ou de um título já baixado) devolve o estado
  existente — `{ receivable, transaction }` / `{ payable, transaction }`, `200` —
  sem duplicar `Transaction`, sem alterar saldo e sem reemitir outbox.
- Não assuma 409 em replay: o contrato é **200 com o recurso original**.

---

## 7. Rate limits

Dois guards sobrepostos com a **mesma tabela** (`GlobalRateLimitGuard` global +
guards por rota em auth/reveal). Estourar qualquer um ⇒ `429 RATE_LIMITED`.

| Preset | Limite | Janela | Chave | Rotas |
|---|---|---|---|---|
| `login` | 5 | 60 s | IP + email/token | `POST /v1/auth/login`, `/v1/auth/refresh` |
| `recovery` | 3 | 1 h | IP + email/token | `/auth/forgot`, `/auth/reset`, `/auth/resend-verification`, `/auth/verify-email` |
| `register` | 10 | 60 s | IP | `POST /v1/auth/register` |
| `verify` | 10 | 5 min | IP | `POST /v1/auth/verify-email` |
| `mfa` | 5 | 5 min | IP + ticket/code | `POST /v1/auth/mfa/*` |
| `webhook` | 100 | 60 s | IP | `/v1/billing/webhooks/*`, `/webhooks/resend` |
| `licenseReveal` | 10 | 1 h | ator (`x-actor-id`/`x-role`/IP) | `/licenses/{id}/reveal`, `/licenses/activate-by-key` |
| `devicePoll` | 120 | 60 s | IP | `/licenses/{id}/validate`, `/licenses/{id}/offline-token` |

`/health/*` **nunca** é limitado (probes). `RateLimit-Policy` é devolvido no
response. Em `NODE_ENV=test` sem identidade, o guard global só loga warn (testes
herméticos).

---

## 8. Referência por domínio

> Legenda de auth: **🔓** público · **🔒** Bearer JWT · **🛡** admin stub
> (`x-role: admin`/`x-service-token`) · **🔑** `x-internal-key` · **💰** finance
> (`finance.read` escopado).

### 8.1 Health e observabilidade

| Método | Rota | Auth | Resposta |
|---|---|---|---|
| GET | `/health/live` | 🔓 | `200 {"status":"ok"}` — sempre 200 se o processo vive |
| GET | `/health/ready` | 🔓 | `200 {status,postgres,redis,dlq}` ou `503` se PG/Redis down; `dlq.warn` **nunca** derruba sozinho |
| GET | `/metrics` | 🔓 (rede interna) | Prometheus, inclui `http_requests_total` |
| GET | `/admin/queues` | 🔓 (stub) | Bull Board |

```bash
curl -f http://localhost:3000/health/ready
# → 200 {"status":"ok","postgres":"up","redis":"up","dlq":{"depth":0,"warn":false}}
```

### 8.2 Auth (`/v1/auth`)

| Método | Rota | Auth | Corpo/DTO | Resposta |
|---|---|---|---|---|
| POST | `/register` | 🔓 | `{email,password≥8,consents[{type∈TERMS,PRIVACY;version}](≥2),deviceLabel?}` | `201 {"ok":true}` |
| POST | `/verify-email` | 🔓 | `{token}` | `200 {"ok":true}` |
| POST | `/resend-verification` | 🔓 | `{email}` | `200 {"ok":true}` |
| POST | `/login` | 🔓 | `{email,password,deviceLabel?}` | `200 LoginResult` **ou** `{mfaRequired:true,mfaTicket,expiresIn:300}` |
| POST | `/refresh` | 🔓 | `{refreshToken?,setCookie?}` (ou cookie) | `200 LoginResult` |
| POST | `/logout` | 🔒 | — | `200 {"ok":true}` |
| GET | `/me` | 🔒 | — | `{identityId,email,emailVerified,mfaEnabled,createdAt}` |
| GET | `/sessions` | 🔒 | — | `{data:[{id,deviceLabel,status,expiresAt,lastSeenAt}]}` |
| DELETE | `/sessions/:id` | 🔒 | — | `200 {"ok":true}` |
| POST | `/forgot` | 🔓 | `{email}` | `200 {"ok":true}` (anti-enumeração) |
| POST | `/reset` | 🔓 | `{token,newPassword≥8}` | `200 {"ok":true}` |
| POST | `/change-password` | 🔒 | `{currentPassword,newPassword≥8}` | `200 {"ok":true}` |
| POST | `/mfa/enroll` | 🔒 | — | dados de enrollment (otpauth URL/segredo) |
| POST | `/mfa/verify` | 🔓/🔒 | `{code, ticket?, deviceLabel?}` | `200 LoginResult` (login) ou confirmação (enrollment) |
| GET | `/auth/gdpr/export` | 🔒 | — | dados do titular (LGPD) |
| POST | `/auth/gdpr/anonymize` | 🔒 | — | anonimização (rodar `customers/gdpr/anonymize` antes) |

```json
// 200 LoginResult
{ "accessToken": "eyJ…", "refreshToken": "hex…", "tokenType": "Bearer", "expiresIn": 900 }
// 200 MFA exigido
{ "mfaRequired": true, "mfaTicket": "…", "expiresIn": 300 }
```

Erros: `401 INVALID_CREDENTIALS` (genérico), `403 EMAIL_NOT_VERIFIED`,
`423 ACCOUNT_LOCKED` (após 5 falhas, 15 min), `401 REUSE_DETECTED`,
`403 FORBIDDEN_ORIGIN` (refresh via cookie cross-origin).

### 8.3 Access — a autoridade do "posso usar?"

| Método | Rota | Auth | Query/Body |
|---|---|---|---|
| GET | `/v1/access/check` | 🔒 | `ownerType∈{CUSTOMER,ORGANIZATION}`, `ownerId`, `productId`, `featureCode`, `channel?∈{WEB,DESKTOP}` |
| POST | `/v1/access/check-batch` | 🔒 | `{ checks: CheckAccessQuery[] }` (1..50) |

> **Divergência registrada (§14):** o `README.md` §9 e o inventário chamam essas
> rotas de "públicas (server-to-server)". No código atual o controller **não** tem
> `@Public()` e o `JwtAuthGuard` é global ⇒ **exige Bearer JWT** (comprovado pelo
> e2e `test/access.check.e2e-spec.ts`, que espera `401` sem token).

Resposta (`CheckAccessResponseSchema`, validada por zod):

```json
// permitido
{ "allow": true, "degraded": false, "reason": "ACTIVE",
  "entitlementId": "ent-123", "origin": "LICENSE", "priority": 30,
  "quotaValue": null, "cached": false }

// em graça
{ "allow": true, "degraded": true, "reason": "GRACE", "entitlementId": "…",
  "origin": "SUBSCRIPTION", "priority": 20, "cached": true }

// negado
{ "allow": false, "degraded": false, "reason": "EXPIRED" }
```

Semântica de `reason` (de `excelência` em `access-policy.ts`):

| `reason` | `allow` | Significado |
|---|---|---|
| `ACTIVE` | true | vigente |
| `LIFETIME` | true | sem `expires_at` |
| `GRACE` | true, `degraded:true` | após expirar, dentro da graça (3 d) |
| `NOT_FOUND` | false | não há entitlement |
| `REVOKED` | false | todos os candidatos revogados |
| `SUSPENDED` | false | candidato de maior prioridade suspenso |
| `EXPIRED` | false | além da graça (ou sem graça) |
| `CHANNEL_MISMATCH` | false | direito existe, mas não neste canal (Fase 8) |

Regras: **Entitlement é a fonte da verdade**; entre candidatos vence a maior
`priority` (`BONUS=5 < CONTRACT=10 < SUBSCRIPTION=20 < LICENSE=30`). Cache de 60 s
com **`channel` na chave** (sem isso, `ALLOW` vazaria entre canais).

### 8.4 Licensing — ciclo de vida (admin)

Core em `/v1/licenses` (`licensing.controller.ts`):

| Método | Rota | Auth | DTO | Efeito |
|---|---|---|---|---|
| GET | `/v1/licenses?ownerType=&ownerId=&productId=&status=` | 🔒/🛡 | — | `{items:[…]}` |
| GET | `/v1/licenses?mine=1` | 🔒 | — | licenças do titular (`ownerId` = identityId do JWT) |
| GET | `/v1/licenses/:id` | 🔒 | — | licença **mascarada** |
| GET | `/v1/licenses/:id/history` | 🛡 | — | histórico append-only (PG outbox) |
| POST | `/v1/licenses` | 🛡 | `IssueLicenseDto` | emite licença; **plaintext 1x** |
| POST | `/v1/licenses/trial-issue` | 🛡 | `TrialIssueRequest` | lote demo/promo (trial/lifetime) |
| POST | `/v1/licenses/:id/renew` | 🛡 | `{kind?}` | renova (nova linha/chave, continuidade) |
| POST | `/v1/licenses/:id/suspend` | 🛡 | `{reason}` | suspende |
| POST | `/v1/licenses/:id/resume` | 🛡 | `{reason}` | retoma |
| POST | `/v1/licenses/:id/revoke` | 🛡 | `{reason, replacedBy?}` | revoga (+bump token_version) |
| POST | `/v1/licenses/:id/reveal` | 🛡+MFA / `x-scope:license.read` | `{reason}` | revela 1x, audita, 10/h |
| POST | `/v1/licenses/internal/issue-from-payment` | 🔑 | `IssueFromPaymentDto` | worker→API: emite licença do pagamento (claim-first) |

`IssueLicenseDto`: `ownerType`, `ownerId`, `productId`, `planId?`,
`months?` (1|12), `maxDevices?` (1..50), `paidAt?`, `actor?`, `ownerLabel?`.

**Chave:** formato `AURUM-XXXX-XXXX-XXXX` (CSPRNG 128-bit). O banco guarda só
`key_hash` (SHA-256 UNIQUE) + `prefix/last4` + `key_enc` (envelope AES-256-GCM
via `LICENSE_MASTER_KEY_PATH`). Plaintext trafega **uma única vez** (issue/reveal);
logs e listagens jamais.

```json
// POST /v1/licenses → 201
{ "license": { "id":"lic_…","keyMasked":"AURUM-••••-••••-PL4T","productId":"prd_…",
               "status":"active","expiresAt":"2027-01-17T…","graceUntil":"2027-01-20T…" },
  "key": "AURUM-7Q2M-9XKD-PL4T" }
```

Há uma **segunda superfície** (fluxo, `licenses.controller.ts`, `x-role: admin`
via `AdminStubGuard`) preservada para o BFF, com rotas equivalentes
(`:id/renew|revoke|reveal|rotate`, `:id/devices/link|unlink|block`,
`:id/check`, `:id/offline-token`, `offline/check`). Ver §14 para o risco de
sobreposição.

### 8.5 Ativação e Device — o coração do programa gerenciado

#### `POST /v1/licenses/activate-by-key` 🔓 *(rate-limit `licenseReveal`)*

| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| `key` | string | ✅ | `^AURUM-[A-Z0-9-]+$` (10..64) |
| `app_instance_id` | string (≤128) | recomendado | id estável da instalação; servidor deriva o HMAC |
| `label` | string (≤120) | opcional | ex. "PC do caixa" |
| `ip` | string (≤64) | **recomendado** | IP local da máquina (promo/bonificação); ausente = IP da conexão (atrás de NAT todos parecem um) |

```json
// 200 ActivationResult (mode: "key")
{ "mode": "key", "licenseId": "lic_…", "keyMasked": "AURUM-••••-••••-PL4T",
  "productId": "prd_…", "planId": "pln_…",
  "expiresAt": "2027-01-17T12:00:00.000Z", "graceUntil": "2027-01-20T12:00:00.000Z",
  "device_hash": "9f2c…(hex64)", "deviceCreated": true,
  "offlineToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImxvY2FsLWhzMjU2LTEifQ.…",
  "off_exp": 1770000000, "token_version": 1 }
```

Erros: `404 KEY_INVALID` (genérico anti-enumeração), `403 LICENSE_INACTIVE`,
`409 DEVICE_LIMIT` (com `maxDevices:true`), `409 DEVICE_CONFLICT`,
`403 DEVICE_BLOCKED`.

#### Devices (`/v1/licenses/{id}/devices…`)

| Método | Rota | Auth | Status | Notas |
|---|---|---|---|---|
| GET | `/{id}/devices` | 🔒/🛡 | 200 | `{licenseId, devices:[DeviceView]}` |
| POST | `/{id}/devices/link` | 🔒/🛡 | **201** | `{device_hash?, app_instance_id?, ip?, label?}`; limite com `FOR UPDATE`; `409 DEVICE_LIMIT` / `403 DEVICE_BLOCKED` |
| POST | `/{id}/devices/unlink` | 🔒/🛡 | 200 | `{device_hash}` (ou `app_instance_id`) |
| POST | `/{id}/devices/rotate` | 🔒/🛡 | 200 | `{old_device_hash,new_device_hash,label?}` → `dual_accept_until` (+15 min) |
| POST | `/{id}/devices/{hash}/block` | 🛡 | 200 | `{reason}` |

`DeviceView`: `{ device_hash, label, status, first_seen, last_seen, ip_hint, cloned_suspect }`.
Estados de device: `active`, `blocked`, `rotated` (dual-accept 15 min), removido.
`ip_hint` é `/24` mascarado; `ip_hash` é HMAC com salt rotativo — **raw IP só em memória**.

#### `POST /v1/licenses/{id}/validate` 🔓 *(rate-limit `devicePoll`)* — **sempre 200**

| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| `device_hash` | hex64 | ✅ | `^[0-9a-f]{64}$` |
| `ip` | string (≤64) | opcional | se ausente, usa `x-forwarded-for`/conexão |
| `country` | string (≤8) | opcional | geo-IP aproximada (só em memória, sinal de clone) |
| `token_iat` | int ≥0 | opcional | `iat` do token apresentado (detecta iat futuro) |
| `ctr` | int ≥0 | opcional | contador do token (rollback = clone) |

```json
// 200 permitido
{ "licenseId":"lic_…","device_hash":"9f2c…","allow":true,"degraded":false,"reason":"ACTIVE" }
// 200 negado (nunca 4xx — evita retry-storm)
{ "licenseId":"lic_…","device_hash":"9f2c…","allow":false,"degraded":false,
  "reason":"CLONE_SUSPECT","errorCode":"CLONE_SUSPECT" }
```

`reason` possível: `ACTIVE`, `LIFETIME`, `GRACE` (allow) · `REVOKED`,
`SUSPENDED`, `EXPIRED`, `LICENSE_NOT_FOUND`, `LICENSE_INACTIVE`,
`UNKNOWN_DEVICE`, `DEVICE_BLOCKED`, `CLONE_SUSPECT`, `ROTATED_EXPIRED`,
`DUAL_ACCEPT_ROTATE` (deny/rotação). Sinais de clone marcam
`cloned_suspect` + emitem `DeviceCloneSuspected.v1` + `SecurityEvent CLONE_SUSPECT`.

#### `GET /v1/licenses/{id}/offline-token?device_hash=…` 🔓 *(rate-limit `devicePoll`)*

Exige online + device `active` (não bloqueado, sem clone). Retorna:

```json
{ "licenseId":"lic_…","device_hash":"9f2c…",
  "token":"<JWT HS256>","kid":"local-hs256-1",
  "lic_exp":1769000000,"grace_until":1770000000,"off_exp":1770000000,"token_version":1 }
```

Erros: `404 LICENSE_NOT_FOUND`/`UNKNOWN_DEVICE`, `403 LICENSE_REVOKED`/
`LICENSE_SUSPENDED`/`LICENSE_INACTIVE`/`EXPIRED`/`DEVICE_BLOCKED`/`CLONE_SUSPECT`,
`409 DEVICE_NOT_ACTIVE`, `500 OFFLINE_MISCONFIGURED`.

### 8.6 Catálogo — Products / Plans / Features

| Método | Rota | Auth | Notas |
|---|---|---|---|
| GET | `/v1/products` | 🔓 | só `status=ACTIVE`, ordenado por `code` |
| GET | `/v1/products/plans/all` | 🔓 | todas as linhas de plano ACTIVE (para o BFF enriquecer) |
| GET | `/v1/products/:code` | 🔓 | detalhe com `versions[]` e `images[]` |
| GET | `/v1/products/:code/plans` | 🔓 | planos do produto |
| GET | `/v1/plans?productCode=&status=` | 🔓 | lista planos |
| GET | `/v1/plans/:code` | 🔓 | plano corrente |
| GET | `/v1/features?kind=` | 🔓 | features (com `channel`) |
| POST | `/v1/products` `/products/:code/versions` `/products/:code/plans` `/products/:code/archive` | 🛡 | escrita de catálogo |
| POST | `/v1/plans` `/v1/plans/:id/archive` | 🛡 | **sem update de preço** — novo preço = nova linha |
| POST | `/v1/features` | 🛡 | cria feature |

`ProductDetail`: `{ id, code, name, slug, description, status, machinesAllowed,
createdAt, updatedAt, versions:[{id,version,changelog,createdAt}], images:[{id,
filename,originalName,mime,size,url,createdAt}] }`.

`PlanView`: `{ id, productCode, code, name, priceCents, billingInterval,
validFrom, validTo, status, supersededBy, features:[{featureCode,featureName,
kind,channel,unit,value}] }`. `billingInterval ∈ {MONTH, YEAR, ONE_TIME}`.

### 8.7 Billing e checkout

| Método | Rota | Auth | Idempotência |
|---|---|---|---|
| POST | `/v1/billing/customers/sync` | 🔒/🛡 | sync |
| POST | `/v1/billing/invoices` | 🔒/🛡 | `Idempotency-Key` |
| GET | `/v1/billing/invoices/:id` | 🔒/🛡 | leitura |
| POST | `/v1/billing/invoices/:id/cancel` | 🛡 | pós-1ª |
| POST | `/v1/billing/subscriptions` | 🔒/🛡 | `Idempotency-Key` |
| GET | `/v1/billing/subscriptions/:id` | 🔒/🛡 | leitura |
| POST | `/v1/billing/subscriptions/:id/cancel` | 🛡 | pós-1ª |
| POST | `/v1/billing/payments` | 🛡 | `Idempotency-Key` |
| POST | `/v1/billing/payments/:id/confirm` | 🛡 | pós-1ª (emite `PaymentConfirmed`) |
| POST | `/v1/billing/payments/:id/refund` | 🛡 | `Idempotency-Key` |
| **POST** | **`/v1/billing/checkout`** | 🔒 | **`orderId` (UNIQUE)** — cria invoice `PENDING`, **nunca `done`** |
| GET | `/v1/billing/checkout/:orderId` | 🔒 | polling até `PAID` + `licenseId` |
| POST | `/v1/billing/webhooks/asaas` | 🔓 + token `asaas-access-token` | dedupe por `(provider, externalId)`; **sempre 200** |
| POST | `/v1/billing/webhooks/apply` | 🔑 | worker aplica `RECEIVED→VALIDATED→APPLIED` |
| POST | `/v1/billing/webhooks/recon-apply` | 🔑 | reconciliação Asaas |
| GET | `/v1/billing/internal/issue-context/:paymentId` | 🔑 | contexto para emissão da licença |

**Fluxo canônico da compra** (o portal faz, o programa não):

```text
POST /v1/billing/checkout { orderId, ... }        → 201 { orderId, status:"PENDING", invoiceId }
  ↓ cliente paga (PIX/boleto/cartão) na Asaas
POST /v1/billing/webhooks/asaas                    → 200 { received, duplicate }
  ↓ fila billing.webhook.apply → PaymentConfirmed (outbox, jobId=eventId)
GET /v1/billing/checkout/:orderId (polling)        → status PAID + licenseId (só agora)
```

### 8.8 Finance (33 rotas) — default-deny

Todas sob `@CustomerScope()` com escopo por org (`x-org-id`). Leitura exige
`finance.read` (`x-finance-read: <orgId>` ou `x-role: admin`); escrita/baixa exige
admin + escopo. Baixas (`mark-received`/`mark-paid`) e despesas/recebíveis
automáticos exigem `Idempotency-Key` (≥8 chars; ausente/curta ⇒
`400 IDEMPOTENCY_REQUIRED`). Replay da mesma chave — buscada por org
(`idempotencyKey` + `orgId`) — devolve o existente (`200`), sem duplicar
`Transaction` nem saldo.

| Grupo | Rotas |
|---|---|
| Visão geral / catálogo | `GET /v1/finance/overview`, `/categories`, `/categories/:id`, `/accounts`, `/accounts/:id` |
| Recebíveis | `GET/POST /v1/finance/receivables`, `POST /v1/finance/receivables/:id/mark-received` *(chave obrigatória)*, `POST /v1/finance/receivables/auto` *(chave obrigatória)* |
| Pagáveis | `GET/POST /v1/finance/payables`, `POST /v1/finance/payables/:id/mark-paid` *(chave obrigatória)* |
| Extrato / saldo | `GET /v1/finance/transactions`, `GET /v1/finance/balance?orgId=` |
| Projeções | `GET /v1/finance/projections?scope=monthly\|quarterly\|annual&ref=&tz=` (HIT 200 · MISS leve 200 · MISS pesado **202 + jobId**), `GET /v1/finance/projections/jobs/:jobId`, `POST /v1/finance/projections/recompute` |
| Despesas / automação | `POST /v1/finance/expenses` *(chave obrigatória)*, `GET /v1/finance/expenses/:id/automation`, `GET /v1/finance/notifications`, `POST /v1/finance/notifications/:id/read` |
| Grants `finance.read` | `POST /v1/finance/grants`, `GET /v1/finance/grants` |
| Internos (worker) | `POST /v1/finance/internal/sync` 🔑, `/internal/automation/bill-pay` 🔑, `/internal/automation/auto-charge` 🔑, `/internal/compute` 🔑, `/internal/transaction-posted` 🔑 |

**Só `Transaction` muta saldo** (`INCOME`/`EXPENSE`). Previsto e pendente são
projeção. Replay com o mesmo `eventId`/`Idempotency-Key` devolve o existente.

### 8.9 Communications e webhooks de provedor

| Método | Rota | Auth | Comportamento |
|---|---|---|---|
| POST | `/webhooks/resend` | assinatura Svix (`RESEND_WEBHOOK_SECRET`) | `BOUNCED`/`COMPLAINED`/`SENT`; dedupe por `webhookId`; corpo malformado ⇒ `ignored`; **sempre 200** |

### 8.10 Admin/ops

| Método | Rota | Auth | Notas |
|---|---|---|---|
| GET | `/v1/admin/dlq?queue=&page=` | 🛡 + MFA | DLQ paginada |
| POST | `/v1/admin/dlq/:queue/replay` | 🛡 + MFA | `{jobId}`; preserva `jobId`/`eventId` (nunca duplica) |
| GET | `/v1/admin/retention` (dry-run) | 🛡 | simulação de retenção |
| GET | `/v1/audit/events?…` | 🛡 | trilha append-only |

---

## 9. Guia de integração do programa gerenciado (passo a passo)

### 9.1 Boot do app instalado

```text
1) Ler config local: licenseId?, device_hash?, offlineToken?  (OS keychain/DPAPI)
2) Se não há licença:
     a) modo conta  → POST {portal}/api/me/licenses/activate  (cookie de sessão)
     b) modo chave  → POST /v1/licenses/activate-by-key       (usuário digita)
3) Se há token offline → validar localmente (§10). Se DENY OFFLINE_EXPIRED → ir online.
4) Em paralelo, a cada N horas: POST /v1/licenses/{id}/validate (online)
5) Ao renovar/vincular nova máquina → reemitir offline-token (sempre online).
```

**Regras duras para o cliente** (de PROJETO §1/§4, inegociáveis):

- **Nunca** derivar o HMAC do device no cliente (o segredo é só do servidor).
- **Nunca** logar a chave, o token offline ou o `refreshToken`.
- **Nunca** auto-bloquear por falha de rede: 5xx/timeout ≠ licença inválida.
  Mantenha o último estado válido e avise o usuário.
- **Nunca** confiar no relógio do sistema sozinho: use tempo monotônico para
  `off_exp`; `off_exp` **nunca** estende validade.
- Retry com backoff **exponencial** + idempotência; trate `429` com `Retry-After`.
- Persistir `app_instance_id` entre sessões/reinstalações (evita vínculos órfãos).

### 9.2 Modo chave — exemplo completo (TypeScript, Node 18+)

```ts
const API = process.env.AURUM_API_URL ?? 'https://api.aurumbit.com';

type ActivationResult = {
  mode: 'account' | 'key';
  licenseId: string;
  keyMasked?: string | null;
  productId?: string | null;
  expiresAt?: string | null;
  graceUntil?: string | null;
  device_hash: string;
  offlineToken: string;
  off_exp?: number | null;
  token_version?: number;
};

async function activateByKey(input: {
  key: string; appInstanceId: string; label?: string; localIp?: string;
}): Promise<ActivationResult> {
  const res = await fetch(`${API}/v1/licenses/activate-by-key`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': crypto.randomUUID(),
    },
    body: JSON.stringify({
      key: input.key,
      app_instance_id: input.appInstanceId,
      label: input.label,
      ip: input.localIp,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${body.code ?? res.status}: ${body.message ?? 'falha na ativação'}`);
  return body as ActivationResult;
}

async function validateOnline(licenseId: string, deviceHash: string, ctr: number, tokenIat: number) {
  const res = await fetch(`${API}/v1/licenses/${encodeURIComponent(licenseId)}/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_hash: deviceHash, ctr, token_iat: tokenIat }),
  });
  // Sempre 200; o corpo decide. Nunca lance por status != 2xx aqui.
  return (await res.json()) as {
    allow: boolean; degraded: boolean; reason: string; errorCode?: string;
  };
}
```

### 9.3 Modo conta (recomendado) — via BFF do portal

```text
POST {portal}/api/me/licenses/activate      (cookies httpOnly, nunca token no JS)
  body: { "productId"?: "prd_…", "app_instance_id": "uuid-da-instalacao", "label": "PC do caixa" }
  → 200 ActivationResult { mode:"account", … }   |    401 UNAUTHORIZED/REVOKED
                                                    404 ACCOUNT_NO_LICENSE  → cair p/ modo chave
                                                    409 DEVICE_LIMIT        → liberar slot no dashboard
                                                    502 UPSTREAM_UNAVAILABLE
```

O BFF executa internamente: `GET /v1/licenses?mine=1` →
`POST /v1/licenses/{id}/devices/link` → `GET /v1/licenses/{id}/offline-token`.

### 9.4 Máquina de estados que o app deve implementar

| Estado | Fonte | Ação do app |
|---|---|---|
| `ALLOW` (`ACTIVE`/`LIFETIME`) | online `validate` ou token local válido | operação normal |
| `ALLOW degradado` (`GRACE`) | `degraded:true` | banner "renove para continuar"; **sem** ações destrutivas |
| `DENY EXPIRED` | `reason:"EXPIRED"` | bloquear uso, oferecer renovação |
| `DENY OFFLINE_EXPIRED` | `reason:"OFFLINE_EXPIRED"` | exigir reconexão (online) |
| `DENY DEVICE_BLOCKED` | `reason:"DEVICE_BLOCKED"` | orientar suporte (nunca contornar) |
| `DENY CLONE_SUSPECT` | `reason:"CLONE_SUSPECT"` | exigir revalidação online/suporte |
| `DENY CHANNEL_MISMATCH` | `reason:"CHANNEL_MISMATCH"` | este canal não é licenciado (ex. cliente desktop de licença `WEB`) |
| `DEVICE_LIMIT` | `409` na ativação | orientar liberar slot em `/dashboard/sistemas` |

---

## 10. Contrato do token offline (validação no cliente)

**Formato:** JWT HS256 (`kid: local-hs256-1` hoje; roadmap: ES256 + JWKS no KMS).

**Claims** (`offline-jwt.ts` / `libs/offline-token/src/token.ts`):

| Claim | Tipo | Significado |
|---|---|---|
| `iss` | string | emissor (`JWT_ISS`, default `aurum-bit`) |
| `sub` | string | **license id** |
| `owner` | string | ownerId |
| `product` | string | productId |
| `feat` | string[] | features concedidas |
| `ch` | string[] | canais (`WEB`/`DESKTOP`/`BOTH`); ausente = token antigo ⇒ `BOTH` |
| `dev` | string | **device_hash** (amarra o token ao aparelho) |
| `lic_exp` | int \| null | validade da licença (null = vitalícia) |
| `grace_until` | int \| null | fim da graça |
| `off_exp` | int | **teto offline** = `min(iat + 7d, lic_exp + 7d)` |
| `tv` | int | `token_version` (bump em revogação invalida tokens antigos) |
| `iat` (+alias `iati`) | int | emissão |
| `jti` | string | id único |
| `ctr` | int? | contador monotônico (rollback/replay = clone) |

**Precedência de decisão offline** (implementada em `validateOfflineToken` e
`evaluateOfflineStatus` — não flexibilizar no cliente):

```text
status revoked                     → DENY REVOKED
status suspended                   → DENY SUSPENDED
tv ≠ tv_esperado                   → DENY TOKEN_VERSION_MISMATCH (exige online)
agora > grace_until                → DENY EXPIRED          (mesmo com off_exp válido)
agora > off_exp                    → DENY OFFLINE_EXPIRED  (exige online)
agora ≤ lic_exp                    → ALLOW ACTIVE
senão (dentro da graça)            → ALLOW degradado (GRACE)
vitalícia (lic_exp null)           → ALLOW LIFETIME, limitado só por off_exp
```

Checagens de integridade adicionais que o **servidor** injeta (o cliente recebe
como metadados do último `validate`): `ISS_MISMATCH`, `DEVICE_MISMATCH`,
`DEVICE_BLOCKED`, `CLONE_SUSPECT`, `CHANNEL_MISMATCH`, `iat` futuro > 300 s,
`ctr` regressivo.

**Renovação em graça mantém continuidade:** `starts_at = max(now, expires_anterior)`.
**Revogação = bump `token_version`:** o próximo `validate` online derruba o token local.

---

## 11. Receitas rápidas (copy/paste)

```bash
API=http://localhost:3000

# 1. Login (usuário)
curl -s -X POST "$API/v1/auth/login" -H 'content-type: application/json' \
  -d '{"email":"op@aurumbit.com","password":"senha-forte","deviceLabel":"notebook"}'
# → { accessToken, refreshToken, tokenType:"Bearer", expiresIn:900 }

# 2. Check-access (autoridade) — exige Bearer hoje
curl -s "$API/v1/access/check?ownerType=CUSTOMER&ownerId=idn_123&productId=prd_1&featureCode=TERMINAL&channel=DESKTOP" \
  -H "Authorization: Bearer $AT"
# → { "allow":true,"degraded":false,"reason":"ACTIVE","origin":"LICENSE","priority":30,"cached":false }

# 3. Ativar por chave (programa)
curl -s -X POST "$API/v1/licenses/activate-by-key" -H 'content-type: application/json' \
  -d '{"key":"AURUM-7Q2M-9XKD-PL4T","app_instance_id":"inst-abc","ip":"203.0.113.10"}'

# 4. Validar online (sempre 200)
curl -s -X POST "$API/v1/licenses/lic_1/validate" -H 'content-type: application/json' \
  -d '{"device_hash":"'"$DH"'","ctr":7,"token_iat":1768000000}'

# 5. Emitir/renovar offline-token (exige online)
curl -s "$API/v1/licenses/lic_1/offline-token?device_hash=$DH"

# 6. Reveal auditado (admin + MFA step-up)
curl -s -X POST "$API/v1/licenses/lic_1/reveal" \
  -H 'content-type: application/json' -H 'x-role: admin' -H 'x-mfa: verified' \
  -d '{"actor":"op@aurumbit.com","reason":"suporte ticket #4821"}'
```

---

## 12. Matriz de rastreabilidade (fonte → seção)

| Seção | Fonte no repo |
|---|---|
| §1 prefixo/exceções | `apps/api/src/main.ts` |
| §2 convenções | `libs/contracts/src/index.ts`, `apps/api/src/modules/licensing/dto.ts` (comentário de padrão) |
| §3 CORS/helmet | `apps/api/src/common/http/security.ts`, `main.ts` |
| §3.5 Swagger UI | `apps/api/src/common/openapi/swagger.ts`, `main.ts`, `apps/api/src/config/env.schema.ts`, `apps/api/Dockerfile` |
| §4.1 JWT/guards | `apps/api/src/common/auth/jwt.service.ts`, `jwt-payload.ts`, `common/guards/*` |
| §4.2 device_hash | `apps/api/src/modules/licensing/devices.service.ts` (`resolveDeviceHash`) |
| §4.3 `x-internal-key` | `modules/billing/webhook.controller.ts`, `modules/finance/sync.controller.ts`, `modules/finance/projections.guard.ts` |
| §4.4/§4.5 admin/finance | `modules/{access,licensing,products}/admin.guard.ts`, `modules/finance/finance-read.guard.ts` |
| §5 erros | `libs/contracts/src/index.ts`, `apps/api/src/common/filters/http-exception.filter.ts` |
| §6 idempotência | `modules/billing/billing.controller.ts`, `modules/finance/finance.controller.ts`, `modules/finance/finance-automation.controller.ts` |
| §7 rate limits | `apps/api/src/common/rate-limit/global-rate-limit.guard.ts`, `modules/auth/rate-limit.ts`, `modules/licensing/reveal.guard.ts` |
| §8.3 access | `modules/access/access.controller.ts`, `access-check.service.ts`, `access-policy.ts`, `libs/contracts/src/access.ts` |
| §8.4/§8.5 licensing/ativação | `modules/licensing/{licensing,licenses,activation,devices,offline-token}.controller.ts`, `devices.dto.ts`, `dto.ts`, `licenses.dto.ts` |
| §8.6 catálogo | `modules/products/{products,plans}.service.ts`, `libs/contracts/src/products.ts` |
| §8.7–8.10 | `.planning/ENDPOINTS-INVENTORY.md` §§1.5–1.21 + `.env.example` |
| §9/§10 contrato do app | `docs/ACTIVATION.md`, `docs/produtos-offline.md`, `libs/offline-token/src/token.ts`, `modules/licensing/offline-jwt.ts` |
| §14 divergências | `README.md` §9/§13, `.planning/ENDPOINTS-INVENTORY.md` (notas de TODO/stub) |

---

## 13. Segurança do canal e do segredo

- **Segredos:** `JWT_SECRET` (≥16, prod 32+ bytes), `OFFLINE_TOKEN_SECRET`,
  `LICENSING_DEVICE_SECRET`/`DEVICE_HMAC_SECRET`, `IP_HASH_SALT`,
  `INTERNAL_WEBHOOK_KEY`, `INTERNAL_PROJECTION_KEY`, `LICENSE_MASTER_KEY_PATH`.
  Ausentes em produção ⇒ **fail-fast** no boot (`env.schema.ts`) ou `500`/`503`
  honesto. Nunca hardcode; nunca commite.
- **Mestra de licença:** vive em **arquivo** (`chmod 600`, montado por volume).
  Perdê-la é irreversível — cópia cifrada off-VPS **antes** da primeira licença.
  Sem mestra, `reveal` responde `409` por desenho.
- **Cripto de chave:** `key_hash` SHA-256 UNIQUE + envelope AES-256-GCM
  (`v2.<masterVer>.<encDEK>.<iv>.<ct>.<tag>`).
- **LGPD:** IP só como `ip_hash` (HMAC, salt rotativo 90 d) + `/24` mascarado;
  raw só em memória; `device_hash` vive a vida da licença + 12 meses; sem GPS.
- **Auditoria:** `reveal`, grant financeiro, replay de DLQ e baixa manual geram
  trilha com ator + motivo. `audit.security_events` registra `LOGIN_FAILED`,
  `MFA_FAILED`, `TOKEN_ROTATED`, `DEVICE_BLOCKED`, `CLONE_SUSPECT`, `KEY_REVEALED`
  — payload **sem PII**.

---

## 14. Lacunas e divergências conhecidas (transparência)

Registradas para você decidir o alinhamento; **nenhuma** impede a integração.

| # | Divergência | Onde |
|---|---|---|
| 1 | `access/check` e `check-batch` são descritos como **públicas server-to-server** no README §9 e no inventário, mas o código **exige Bearer JWT** (guard global, sem `@Public()`); e2e confirma `401` sem token. | `access.controller.ts` × `README.md` §9 |
| 2 | `activate-by-key` e `{id}/validate` são públicos; o `check-access` (para programas) exigiria credencial de serviço — hoje só JWT de usuário. Falta *service-token* dedicado para o app instalado chamar `check-access`. | TODO em `access.controller.ts` / `access-admin.controller.ts` |
| 3 | RBAC é **stub** (`x-role`, `x-service-token`, `x-mfa`, `x-scope`) em vez da cadeia Roles/Scope real. | `modules/*/admin.guard.ts` |
| 4 | `ActivationResultSchema` (contrato zod) tipa `off_exp` como `string`, mas o servidor devolve **número** (epoch s). `ACTIVATION.md` também diz string. | `libs/contracts/src/activation.ts` × `offline-token.service.ts` |
| 5 | Duas superfícies de licença coexistindo (`licensing.controller.ts` core PG × `licenses.controller.ts` flow stub), com rotas de mesmo nome; o core "sombreia" as do flow onde colidem. | `modules/licensing/*` |
| 6 | `http-exception.filter.ts` ainda é passthrough mínimo: **não** garante o `correlationId` dentro do corpo do erro nem mapeia erros de domínio (TODO T5). O envelope `ApiError` é o contrato-alvo, não universalmente aplicado. | `common/filters/http-exception.filter.ts` |
| 7 | `docs/produtos-offline.md` menciona upload de imagem e `GET /v1/products/:code/images` — confirme o caminho vigente (`product-images.controller.ts`) antes de depender dele. | `docs/produtos-offline.md` §1 |
| 8 | `openapi.yaml` cobre a **superfície de integração** (auth, access, licensing/app, catálogo, checkout, health). Admin/finance/worker-internos estão só aqui no Markdown. | `docs/openapi.yaml` |

---

## 15. Changelog desta documentação

| Data | Mudança |
|---|---|
| 2026-10-17 | Versão inicial: topologia, headers, 4 modos de auth, erros, idempotência, rate limits, referência por domínio, guia do programa gerenciado, contrato do token offline, lacunas e `openapi.yaml`. |
| 2026-10-17 | §3.5: API passa a **servir** a spec — Swagger UI em `/docs`, `/docs-json`, `/docs-yaml` (`@nestjs/swagger`, gated por `SWAGGER_ENABLED`, CSP própria). |
| 2026-10-17 | §3.3/§6/§8.8: `Idempotency-Key` **obrigatória** (≥8 chars) nas baixas `mark-received`/`mark-paid` e na automação financeira (`expenses`, `receivables/auto`); ausente/curta ⇒ `400 IDEMPOTENCY_REQUIRED`; replay (`idempotencyKey`+org) devolve o existente (`200`). Billing segue opcional. |
