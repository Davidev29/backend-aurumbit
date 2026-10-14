# 08 — Dados reais: matriz BFF × Nest, sessão real e fatias

> Escopo: trocar o BFF (`apps/admin/app/api/**/route.ts`) de proxy-ou-mock para
> proxy real, sem quebrar o modo mock (flag `API_INTERNAL_URL` ausente = stub
> `lib/mocks.ts`). Prefixo Nest `/v1` (`apps/api/src/main.ts:38`).
> Achado: existem **30 `route.ts`** no BFF, não 28 (o MAP-REPORT omitiu
> `auth/mfa/enroll` + `auth/mfa/verify`). Todas as 30 estão cobertas abaixo.

## 0. Premissa transversal: headers que o BFF deve injetar

Os guards do Nest hoje são stubs por header — o JWT **não** carrega role/org.
Todo proxy real no BFF deve anexar (helper único, ex.
`apps/admin/lib/api/upstream.ts` → `upstreamHeaders(req)`):

| Header | Origem (BFF conhece via `me`) | Consumido por |
|---|---|---|
| `Authorization: Bearer <access>` | cookie `aurum_session` (passa a guardar o access JWT) | `JwtAuthGuard+SessionGuard` (`auth/guards.ts:14`) — logout, mfa/enroll, futuro `me` |
| `x-actor-id: <userId>` | `me.id` | `actorOf()` em licensing/dlq (auditoria) |
| `x-role: admin` | se `me.permissions` contém `billing.manage`/`finance.manage`/`license.adjust` | `AdminStubGuard` (`access/admin.guard.ts:7`) — licensing mutações, access admin, billing/subscription-cancel, finance escrita, DLQ |
| `x-org-id: <orgId>` | `me.organizationId` | `FinanceController.orgOf` + `FinanceReadGuard` |
| `x-finance-read: <orgId>` | se `me.permissions` contém `finance.read` | `FinanceReadGuard` (`finance/finance-read.guard.ts:24`) — toda leitura finance/projections |
| `Idempotency-Key` | repasse do cliente (gerar se ausente — padrão já existe nas rotas) | billing core, finance core |

Sem esses headers, o modo "real" responde 403 em cascata. Isso é a causa #1 de
falso "backend quebrado" na virada da flag.

---

## 1. Matriz rota-BFF × rota-Nest + classificação

Legenda: **LIGAR** = proxy 1:1 · **ADAPTAR** = proxy com transformação (detalhada)
· **CRIAR** = falta endpoint no Nest (contrato especificado) · **MOCK** = mantém stub.

### 1.1 Auth (6 rotas)

| # | BFF | Contraparte Nest | Classe |
|---|---|---|---|
| A1 | `POST /api/auth/login` (`auth/login/route.ts`) | `POST /v1/auth/login` (`auth.controller.ts:85`, `LoginDto{dto.ts:48}` `{email,password,deviceLabel?}`) | **ADAPTAR** |
| A2 | `POST /api/auth/refresh` (`auth/refresh/route.ts`) | `POST /v1/auth/refresh` (`auth.controller.ts:98`, `RefreshDto{dto.ts:63}` `{refreshToken?,setCookie?}`) | **ADAPTAR** |
| A3 | `POST /api/auth/logout` (`auth/logout/route.ts`) | `POST /v1/auth/logout` (`auth.controller.ts:125`, exige `JwtAuthGuard+SessionGuard`) | **ADAPTAR** |
| A4 | `GET /api/auth/me` (`auth/me/route.ts`) | **SEM CONTRAPARTE** (não existe `GET /v1/auth/me`; o mais próximo é `GET /v1/customers/me` — outro domínio, outro shape) | **CRIAR** |
| A5 | `POST /api/auth/mfa/enroll` (`auth/mfa/enroll/route.ts`) | `POST /v1/auth/mfa/enroll` (`auth.controller.ts:199`, exige `JwtAuthGuard+SessionGuard`, retorna `{secret,otpauthUrl}` — o BFF já gera o QR) | **ADAPTAR** |
| A6 | `POST /api/auth/mfa/verify` (`auth/mfa/verify/route.ts`) | `POST /v1/auth/mfa/verify` (`auth.controller.ts:211`, `MfaVerifyDto{dto.ts:103}` `{code?,ticket?,deviceLabel?}`) | **ADAPTAR** |

Transformações A1/A2/A3/A5/A6 — ver §2 (plano de sessão). A4 contrato:

```ts
// CRIAR: GET /v1/auth/me — guards JwtAuthGuard+SessionGuard
// Response 200:
{ id, email, name, mfaEnabled, mfaVerified, organizationId, permissions: string[] }
// permissions derivadas do membership (role→permissões, mesma tabela do mock:
// OWNER/ADMIN→["customer.read","user.read","license.read","license.adjust",
// "bonus.grant","finance.read","finance.manage","billing.read","billing.manage"],
// FINANCE→["finance.read","billing.read"], MEMBER→[]). Fonte: customers members.
// 401 sessão inválida/expirada (shape {code,message} atual).
```

### 1.2 Licenças (5 rotas)

| # | BFF | Contraparte Nest | Classe |
|---|---|---|---|
| L1 | `POST /api/licenses/:id/reveal` | `POST /v1/licenses/:id/reveal` (`licensing.controller.ts:63`, `RevealLicenseDto{licenses.dto.ts:60}` `{reason?}`, guards `RevealRateLimitGuard+LicenseReadGuard`) | **ADAPTAR** |
| L2 | `POST /api/licenses/:id/renew` | `POST /v1/licenses/:id/renew` (`licensing.controller.ts:34`, `RenewLicenseDto{licenses.dto.ts:45}` `{kind?: monthly\|annual}`, guard `AdminStubGuard`) | **ADAPTAR** |
| L3 | `POST /api/licenses/:id/revoke` | `POST /v1/licenses/:id/revoke` (`licensing.controller.ts:52`, `LicenseReasonDto{licenses.dto.ts:52}` `{reason≥10}`, guard `AdminStubGuard`) | **ADAPTAR** |
| L4 | `POST /api/licenses/:id/adjust` | **SEM CONTRAPARTE** (`POST /v1/access/adjustments` existe mas é só log genérico `LogAdjustmentDto{access/dto.ts:209}` `{actor,action,targetType?,targetId?,reason}` — não muta `machinesAllowed`) | **CRIAR** |
| L5 | `POST /api/licenses/:id/bonus` | **SEM CONTRAPARTE direta** (`POST /v1/access/bonus` com `GrantBonusDto{access/dto.ts:169}` `{ownerType,ownerId,productId?,featureCode?,reason≥10,endsAt?,grantedBy}` exige owner resolvido) | **CRIAR** (wrapper; fallback ADAPTAR documentado) |

Transformações:

- L1: UI envia `{motivo?}` (`lib/licenses.ts:27`); Nest quer `{reason?}` → BFF
  mapeia `motivo→reason`. Resposta Nest
  `{licenseId,key,keyMasked,revealedAt}` vs UI `LicenseRevealResponse{key,auditId}`
  (`lib/types.ts:65`): **o Nest não retorna `auditId`** (só `logger.log
  license.reveal`). BFF sintetiza `auditId = revealedAt+licenseId`? Não — exige
  mudar o Nest a retornar id do audit quando `audit.AuditEvent` existir
  (TODO já marcado em `licensing.controller.ts:61`). Interim: BFF responde
  `{key, auditId: \`reveal-${licenseId}-${revealedAt}\`}` e remove quando o Nest
  retornar `auditId` real. Header `X-Aurum-Audit` mantido.
- L2: UI `{months: 1|12}` (`lib/types.ts:81`) → Nest `{kind: monthly|annual}`:
  `1→monthly`, `12→annual`. Resposta Nest = licença atualizada (row PG); BFF
  extrai `{expiresAt: row.expiresAt}` p/ preservar contrato da UI.
- L3: UI `{motivo,confirmacao}` → Nest `{reason: motivo}` (`confirmacao===true`
  validada no BFF, 422 senão — regra já existe no stub). Resposta Nest = licença;
  BFF responde `{revoked:true}`.
- L4 contrato (CRIAR no `LicensingController`):
  `POST /v1/licenses/:id/adjust` + `AdminStubGuard`, body
  `{delta: int ≠0, |delta|≤100, reason: string≥10}` (espelha validação do stub
  `adjust/route.ts:35`), muta `machinesAllowed` com `FOR UPDATE`, emite
  `access.entitlement.updated.v1` + audit. Response `{id, machinesAllowed}`.
- L5 contrato (CRIAR wrapper fino sobre `BonusService.grantBonus`):
  `POST /v1/licenses/:id/bonus` + `AdminStubGuard`, body
  `{reason≥10, endsAt: ISO|null}`; o Nest resolve `license→owner{ownerType,ownerId,
  productId}` e delega a `POST /v1/access/bonus` com `grantedBy=x-actor-id`.
  Response `{bonusId}`. Fallback sem Nest novo: BFF em 2 chamadas
  (`GET /v1/licenses/:id` → `POST /v1/access/bonus`) — desaconselhado (condição
  de corrida + 2 round-trips; usar só como interim).

### 1.3 Billing (7 rotas)

| # | BFF | Contraparte Nest | Classe |
|---|---|---|---|
| B1 | `GET /api/billing/invoices?status&dueFrom&dueTo&cursor&limit` | **SEM CONTRAPARTE** (só `GET /v1/billing/invoices/:id` — `billing.controller.ts:32`, row crua sem filtros) | **CRIAR** |
| B2 | `GET /api/billing/invoices/:id` | `GET /v1/billing/invoices/:id` (`billing.service.ts:168` retorna **só a row invoice**, sem payments) | **ADAPTAR** |
| B3 | `POST /api/billing/invoices/:id/refund` | `POST /v1/billing/payments/:id/refund` (`billing.controller.ts:75`, `CreateRefundDto{billing.dto.ts:194}` `{amount_cents!,external_id?,reason?}` — **é por payment, não por invoice**) | **ADAPTAR** |
| B4 | `GET /api/billing/subscriptions?status&cursor&limit` | **SEM CONTRAPARTE** (só `GET /v1/billing/subscriptions/:id` — `billing.controller.ts:47`) | **CRIAR** |
| B5 | `POST /api/billing/subscriptions/:id/cancel` | `POST /v1/billing/subscriptions/:id/cancel` (`billing.controller.ts:52`, `CancelDto{billing.dto.ts:100}` `{reason≥10}`) | **ADAPTAR** |
| B6 | `GET /api/billing/audit?actor&resource&correlationId&from&to&cursor&limit` | **SEM CONTRAPARTE** (`AuditController` vazio — `audit.controller.ts:1`; dados existem em `AuditService.list()` usado pelo flow `finance-flow.controller.ts:132`) | **CRIAR** |
| B7 | `GET /api/billing/export?scope=` (CSV `;`) | **SEM CONTRAPARTE** (nenhum endpoint de export no Nest) | **CRIAR** |

Transformações/contratos:

- B1 contrato: `GET /v1/billing/invoices?status=&due_from=&due_to=&limit=&cursor=`
  (cursor = id, `ORDER BY createdAt,id`, retorna `{data, meta:{nextCursor,limit}}`
  — shape `Page` que a UI já consome). Sem guard hoje no core (adicionar
  `AdminStubGuard` leitura? core não tem — BFF exige `billing.read` via `me`).
- B2: Nest retorna row snake_case; BFF compõe `{invoice, payments}`. Problema:
  **não há listagem de payments por invoice** (só `GET payments/:id`). Opções:
  (a) CRIAR `GET /v1/billing/invoices/:id/payments` (preferido, 1 query por
  `invoiceId`); (b) interim: BFF retorna `{invoice: row, payments: []}` e a UI
  exibe "pagamentos indisponíveis" — quebra a aba Pagamentos. Exige (a).
  Mapear `amount_cents→amount` (÷100), `due_date→dueDate` etc. (fio snake_case,
  `billing.dto.ts:14`).
- B3: BFF recebe `invoiceId` + `{motivo,confirmacao}`; Nest exige `paymentId` +
  `{amount_cents!, reason?}`. Fluxo BFF: `GET invoice` → `GET
  invoices/:id/payments` (depende de B2-a) → escolhe payment CONFIRMED mais
  recente → `POST /v1/billing/payments/:paymentId/refund`
  `{amount_cents: total, reason: motivo}` + `Idempotency-Key` repassado.
  Validação `status===PAID` do stub vira checagem do payment CONFIRMED.
- B4 contrato: `GET /v1/billing/subscriptions?status=&limit=&cursor=` → Page.
- B5: `{motivo,confirmacao}` → `{reason: motivo}` (mesmo padrão L3). LIGAR seria
  possível se o BFF renomeasse o campo — classificado ADAPTAR só pelo rename.
- B6 contrato: `GET /v1/audit/events?actor=&resource=&correlation_id=&from=&to=
  &cursor=&limit=` → Page ordenado `occurredAt DESC` (igual ao stub
  `mockAuditPage`), append-only, sem PII além do mascarado. Expõe
  `AuditService.list()` via HTTP pela 1ª vez.
- B7 contrato: `GET /v1/billing/export?scope=invoices|subscriptions|audit&<mesmos
  filtros da lista>` → `text/csv; charset=utf-8` (`;`-separado, mesmo header do
  stub) + emite audit `billing.export {actor,scope,filtros}`. BFF só repassa
  bytes + `Content-Disposition` (código já existe em `billing/export/route.ts:20`).

### 1.4 Finance (10 rotas)

| # | BFF | Contraparte Nest | Classe |
|---|---|---|---|
| F1 | `GET /api/finance/summary` | Indireta: `GET /v1/finance/overview?from&to` (`finance.controller.ts:65`, retorna buckets em **cents** + `accounts` + `net` — `finance.service.ts:477`) | **ADAPTAR** |
| F2 | `GET /api/finance/transactions?kind&category&product&from&to&cursor` | `GET /v1/finance/transactions` (`finance.controller.ts:175`, `TransactionListQueryDto{finance.dto.ts:186}` `{account_id?,kind: INCOME\|EXPENSE,from?,to?,limit?}` — **sem cursor, sem category/product**) | **ADAPTAR** |
| F3 | `GET /api/finance/receivables?...` | `GET /v1/finance/receivables` (`finance.controller.ts:113`, `{status,from,to,limit}` — **retorna array cru, sem Page; sem category/product/cursor**) | **ADAPTAR** |
| F4 | `GET /api/finance/payables?...` | `GET /v1/finance/payables` (`finance.controller.ts:144`, idem F3) | **ADAPTAR** |
| F5 | `POST /api/finance/receivables/:id/settle` | `POST /v1/finance/receivables/:id/mark-received` (`finance.controller.ts:130`, `MarkReceivedDto{finance.dto.ts:116}` `{account_id!,received_at?,provider?,external_id?}` + `Idempotency-Key`) | **ADAPTAR** |
| F6 | `POST /api/finance/payables/:id/settle` | `POST /v1/finance/payables/:id/mark-paid` (`finance.controller.ts:161`, `MarkPaidDto{finance.dto.ts:141}` idem) | **ADAPTAR** |
| F7 | `GET /api/finance/projection?period&category&product` | Indireta: `GET /v1/finance/projections?scope&ref&tz` (`projections.controller.ts:27`, scopes `monthly\|quarterly\|annual`, HIT 200 / MISS 202 + `jobs/:jobId`) | **ADAPTAR** |
| F8 | `GET /api/finance/facets` | **SEM CONTRAPARTE** (existe `GET categories` e `GET products` abertos, mas não o agregado `{categories,products}` filtrável) | **CRIAR** |
| F9 | `GET /api/finance/trace?receivableId\|payableId` | **SEM CONTRAPARTE** (cadeia charge→invoice→receivable→transaction→audit só existe montada no stub) | **CRIAR** |
| F10 | `GET /api/finance/export?scope=` (CSV `;`) | **SEM CONTRAPARTE** | **CRIAR** |

Transformações/contratos:

- F1: BFF chama `GET /v1/finance/overview` (+ `x-org-id`, `x-finance-read`) e
  deriva `FinanceSummary`: `previsto=(rec.previsto+pay.previsto+pendentes…)/100`,
  `realizado=net.realizadoCents/100`, `inadimplente=rec.inadimplenteCents/100`
  (atenção: Nest usa status `INADIMPLENTE`; UI usa `VENCIDO` — mapear),
  `taxaInadimplencia=delinquencyRate`, `isStale=false, asOf=now()` (dado PG ao
  vivo; `isStale` só volta a `true` se o BFF cair em fallback). Query `from/to`
  do BFF repassada.
- F2–F4: três mismatches sistemáticos: (i) `kind`: UI `RECEITA|DESPESA` →
  `INCOME|EXPENSE`; (ii) `category/product`: Nest não filtra — BFF filtra
  client-side na página (limite: `limit` do Nest vira teto da página; documentar
  que filtro por categoria pode truncar — mitigação futura: coluna no Nest);
  (iii) paginação: Nest retorna array (`finance.service.ts:198` sem cursor) —
  BFF ordena + aplica cursor em memória (igual ao stub `paginate`) e retorna
  Page. `status`/`from`/`to` repassados 1:1. **Shadowing**: `FinanceController`
  (core, registrado 1º em `finance.module.ts:36`) atende; as rotas `†` do flow
  estão mortas — não usar `GET /v1/finance/balance` nem `GET transactions?orgId`
  do flow.
- F5/F6: rename de path `settle→mark-received/mark-paid` + DTO: UI
  `{motivo,confirmacao}` vs Nest que **exige `account_id`** (`finance.service.ts:236`
  `getAccount` + conta ativa). O BFF precisa resolver a conta: `GET
  /v1/finance/accounts` → primeira `active` (ou `?code=` configurável via env
  `FINANCE_DEFAULT_ACCOUNT`). Sem conta ativa → 422 `ACCOUNT_REQUIRED` (novo
  código BFF, documentar na UI). Resposta Nest `{receivable,payable,transaction}`
  → BFF `{transactionId: transaction.id, auditId, status}` (`auditId` interim
  igual L1 até o Nest retornar). `motivo` hoje é descartado pelo Nest — propor
  campo `reason?` futuro no DTO; por ora BFF valida (≥10 + confirmação) e loga.
- F7: `period week|month|year` → `scope monthly|quarterly|annual`
  (`week→monthly` + agregação client-side por semana? Não — decisão: `week→monthly`
  com `ref` = hoje, e o BFF reagrupa `snapshot.buckets` por semana usando a
  mesma regra do stub `bucketOf` segunda-feira UTC; `month→monthly`,
  `year→annual`). `category/product`: filtro client-side sobre buckets (se o
  snapshot não discrimina categoria, projeção com filtro retorna `isStale:true`
  + `staleReason` explicando — preserva o StaleBanner). **202 MISS**: BFF repassa
  `{cache:MISS,…}` e a UI faz polling em `GET /api/finance/projection/job/:id`
  (novo repasse fino p/ `GET /v1/finance/projections/jobs/:jobId`) — ver fatia 6.
- F8 contrato: `GET /v1/finance/facets?orgId=` → `{categories: string[],
  products: string[]}` (distinct de categories + products vinculados; leitura,
  `FinanceReadGuard`). Endpoint barato, elimina 2 round-trips.
- F9 contrato: `GET /v1/finance/trace?receivableId=|payableId=` (leitura,
  `FinanceReadGuard` + `billing.read` implícito) → `{invoice,payments,receivable,
  payable,transactions,audit}` montado server-side via `correlationId`
  (joins billing.finance por `externalId/sourceId` + `audit.list(correlationId)` —
  depende de B6). Interim: **MOCK** (stub atual já monta a cadeia; manter até B6
  existir).
- F10 contrato: `GET /v1/finance/export?scope=payables|receivables|transactions&
  <filtros>` → CSV `;` + audit `finance.export` (mesmo padrão B7).

### 1.5 Filas/DLQ (2 rotas)

| # | BFF | Contraparte Nest | Classe |
|---|---|---|---|
| Q1 | `GET /api/queues/dlq` | **Path errado no BFF**: o real é `GET /v1/admin/dlq?queue=&page=&pageSize=` (`dlq.controller.ts:28`, guard `DlqAdminGuard`, retorna `{items,total,page,pageSize}` + emite audit `dlq.list`) — **não existe `GET /v1/queues/dlq`** | **ADAPTAR** |
| Q2 | `POST /api/queues/dlq/:queue/replay` | `POST /v1/admin/dlq/:queue/replay` (`dlq.controller.ts:56`, body `{jobId?,eventId?,limit?}`, retorna `{queue,mode:'logical',replayed,duplicates,results}` — **replay lógico, sem re-enqueue real, TODO `dlq.controller.ts:76`** ) | **ADAPTAR** |

Transformações:

- Q1: BFF chama `GET /v1/admin/dlq?pageSize=100` (sem `queue` = todas), agrega
  `items` por `queue` → `{queues:[{queue,depth,oldestEnqueuedAt,lastError}],
  isStale:false, asOf}` preservando o contrato da UI (`mockDlqOverview`). UI
  futura pode migrar p/ lista paginada (então vira LIGAR). Alternativa
  `GET /admin/queues` (fora do `/v1`, `admin-queues.controller.ts:14`) é stub
  estático — não usar p/ depth.
- Q2: BFF valida `{motivo≥10, confirmacao:true}` (400 senão — já faz) e chama o
  Nest com `{}` (lote ≤100, respeitando `limit?`) + `Idempotency-Key` repassado;
  resposta `{queue,mode,replayed,duplicates,results}` → BFF
  `{queue, replayed, auditId: \`dlq-${queue}-${Date.now()}\`}` (Nest emite audit
  `dlq.replay` mas não retorna id — mesmo interim L1/F5). Expor `mode:'logical'`
  no BFF p/ a UI sinalizar "replay lógico" (honestidade sobre o TODO).

### Resumo da classificação (30 rotas)

- **LIGAR DIRETO: 0.** Nenhuma rota é 1:1 hoje (todas têm rename de campo/path,
  reshape ou header ausente). Candidatas a virar LIGAR após renames mínimos no
  Nest: B5 (aceitar alias `motivo`), L3 (idem).
- **ADAPTAR: 19** — A1,A2,A3,A5,A6,L1,L2,L3,B2,B3,B5,F1,F2,F3,F4,F5,F6,F7,Q1,Q2.
- **CRIAR NO NEST: 10** — A4 (`auth/me`), L4 (`licenses/:id/adjust`), L5
  (`licenses/:id/bonus`), B1 (list invoices), B2-a (`invoices/:id/payments`,
  pré-requisito de B2/B3), B4 (list subscriptions), B6 (`audit/events`), B7
  (`billing/export`), F8 (`finance/facets`), F9 (`finance/trace`), F10
  (`finance/export`). (11 itens c/ B2-a.)
- **MANTER MOCK: 1 interim (F9 trace)** até B6 existir; + fallback permanente de
  todas as rotas quando `API_INTERNAL_URL` ausente (§2.5). MFA mock (qualquer
  6 dígitos) deve **sumir** asssim que A6 ligar — risco de bypass se coexistir.

---

## 2. Plano de sessão real (JWT Nest sem quebrar o mock)

### 2.1 O que o Nest realmente emite (`auth.service.ts:162`)

- `login` → `{accessToken, refreshToken, tokenType:'Bearer', expiresIn}` ou
  `{mfaRequired:true, mfaTicket, expiresIn:300}` (quando `mfaEnabled`).
  Access JWT 15min (claims `sub/sid/fid/mfa`, `auth/crypto.ts`); refresh hex 32B,
  TTL 30d, **rotação com reuse detection** (`auth.service.ts:213` — reuso revoga
  a família inteira → 401 `REUSE_DETECTED`).
- `refresh` aceita o token **no body ou no cookie `ab_refresh`**
  (`auth.controller.ts:13,102`); cookie tem `Path=/v1/auth`, `httpOnly`,
  `SameSite=Lax`, 30d (`auth.controller.ts:23`). Via cookie exige same-origin
  (`csrf.ts`) — via body, não.
- `logout` exige `Authorization: Bearer <access>` e limpa o cookie `ab_refresh`
  via `Set-Cookie` na resposta (`auth.controller.ts:125`).

### 2.2 Novos cookies do BFF (nomes `aurum_*` preservados p/ não tocar a UI)

| Cookie | Conteúdo | Flags |
|---|---|---|
| `aurum_session` | **access JWT** (troca o `stub-session-*`; `apiFetch` já só depende de 401, não do valor) | `httpOnly`, `Secure=prod`, `SameSite=Lax`, `Path=/`, `MaxAge=900` (15min = TTL do access) |
| `ab_refresh` (novo) | refresh hex do Nest | `httpOnly`, `Secure=prod`, `SameSite=Lax`, `Path=/api/auth`, `MaxAge=30d` |
| `aurum_claims` | `{permissions, organizationId}` (só p/ render imediato do menu; fonte de verdade = `GET me`) | não-httpOnly, `MaxAge=900` |

### 2.3 Fluxos (modo real, `API_INTERNAL_URL` definido)

**Login** (`auth/login/route.ts`): repassa `{email,password,deviceLabel?}` ao
Nest. Se `mfaRequired` → responde `{ok:false, mfaRequired:true,
mfaTicket}` **sem setar cookies**; a UI chama A6 com `{ticket, code}` →
resposta é `LoginResult` normal → BFF seta os 3 cookies e responde
`{ok:true, me}` (busca `me` server-side 1x). Se login direto → seta cookies +
`{ok:true, mfaRequired:false, me}`. Erros (`INVALID_CREDENTIALS` 401,
`EMAIL_NOT_VERIFIED` 403, `ACCOUNT_LOCKED` 423 + `Retry-After`) repassados com
status original — a UI já trata `code` (`ApiClientError.code`).

**Refresh** (`auth/refresh/route.ts`, chamado 1x pelo `apiFetch` a cada 401):
lê `ab_refresh` do cookie e envia **no body** `{refreshToken}` (evita a
checagem CSRF same-origin do Nest, feita só p/ cookie). Sucesso → rotaciona os
3 cookies, responde `{ok:true}` (contrato atual preservado). `REUSE_DETECTED` /
`TOKEN_EXPIRED` / `INVALID_TOKEN` → **limpa os 3 cookies** e 401 (UI cai p/
login; família possivelmente revogada — não tentar de novo).

**Logout**: BFF monta `Authorization: Bearer <aurum_session>` e `POST
/v1/auth/logout`; **repasa `Set-Cookie` do upstream** (limpeza do `ab_refresh`
path `/v1/auth`) e limpa os 3 cookies `aurum_*`. Se o access expirou (401),
ainda assim limpa local (logout é idempotente na UI).

**Me**: `GET /v1/auth/me` (A4, a criar) com o Bearer; BFF repassa o JSON.
`aurum_claims` é só cache de render — divergência resolve no próximo `me`.

**MFA**: A5 anexa o Bearer (não `authorization` do browser — o BFF monta a
partir do cookie; o header atual `auth/mfa/enroll/route.ts:38` nunca chega com
token real). A6 repassa `{code, ticket?, deviceLabel?}` 1:1; erro
`MFA_INVALID_CODE` 401 repassado (a UI não deve confundir com sessão expirada —
não disprar refresh nesse `code`).

### 2.4 Expiração (tabela)

| Token | TTL | Onde vive | Renovação |
|---|---|---|---|
| access JWT | 15min | `aurum_session` httpOnly | silenciosa via refresh no 1º 401 (`apiFetch` já faz) |
| refresh | 30d, rotativo 1-uso | `ab_refresh` httpOnly | cada `refresh` emite o próximo; reuso → família revogada + login |
| sessão Nest | `SESSION_TTL_MS` (ver `auth.service.ts`) | PG `auth_session` | `SessionGuard` nega expirada; `listSessions` p/ o usuário revogar |
| `aurum_claims` | 15min | JS-legível | reemitido a cada login/refresh |

### 2.5 Sem quebrar o mock

- Cada rota mantém o padrão atual: `if (API_INTERNAL_URL) {…real…} else {…stub…}`.
  Nenhum import de `mocks.ts` é removido nesta fase; o mock de MFA (aceita
  qualquer 6 dígitos) **só existe no ramo else**.
- Nomes de cookie `aurum_session`/`aurum_claims` e shapes de resposta do BFF
  (`{ok}`, `{ok:true,mfaRequired,me}`, Page, `{key,auditId}`…) **não mudam** —
  a UI (`lib/*.ts`, `apiFetch`) não é tocada pelo plano de sessão.
- Rollback = remover `API_INTERNAL_URL` (volta tudo a stub, sessão `stub-*`).
- Endurecer: se o upstream falhar com 5xx/timeout em modo real, responder
  502 `UPSTREAM_UNAVAILABLE` (novo código BFF) em vez de cair no stub
  silenciosamente — mock silencioso em prod esconderia indisponibilidade.

---

## 3. Ordem de execução em fatias (risco → desbloqueio)

Critério: auth primeiro (bloqueia tudo) → leituras antes de escritas →
endpoints que existem antes dos a criar → compostos/auditáveis por último.
Cada fatia = Nest (se CRIAR/ADAPTAR exigir) + BFF + UI states; deploy com a
flag ligada em staging, mock intacto em dev.

### Fatia 1 — Auth fim-a-fim (A1–A6 + CRIAR A4) · risco: alto · desbloqueia: tudo

- Nest: criar `GET /v1/auth/me` (contrato §1.1); nada mais (login/refresh/logout/
  mfa já existem e têm teste `reuse.spec.ts`).
- BFF: `upstreamHeaders` (§0) + reescrever as 6 rotas auth conforme §2.3
  (cookies, body-refresh, repasse `Set-Cookie`, rename `motivo→reason` onde há).
- UI: sem mudança (só novos códigos de erro a exibir: `EMAIL_NOT_VERIFIED`,
  `ACCOUNT_LOCKED` c/ retry, `REUSE_DETECTED` → "sessão revogada, entre de novo").
- States: loading no submit (botão desabilitado); erro 401 genérico anti-
  enumeração (não dizer "e-mail inexistente"); vazio N/A; MFA = step dedicado
  (ticket em memória, nunca localStorage).
- Critério de saída: login→refresh (esperar 15min ou forçar access expirado)→
  logout→`me` com a flag ligada; sem flag, stubs passam nos mesmos testes de UI.

### Fatia 2 — Licenças ligadas (L1,L2,L3) · risco: médio · desbloqueia: reveal/renew/revoke reais

- Só ADAPTAR no BFF (mapeamentos §1.2) + `x-role/admin` via `me`.
- UI: reveal exibe `key` 1x + `auditId` (interim `reveal-<id>-<ts>` até o Nest
  retornar id real — sinalizar "trilha pendente de id" se contiver o prefixo?);
  renew mostra novo `expiresAt`; revoke confirmação em 2 passos (já existe).
- States: loading por ação (botão + skeleton do detalhe); erro 422 exibe
  `message` do Nest (regra de negócio, ex. transição ilegal); 429 reveal (10/h)
  → "tente mais tarde" c/ contagem; vazio: licença sem detail → 404 dedicada.
- Risco: `LicenseReadGuard` stub — verificar o que ele exige (header?) antes de
  ligar, senão reveal dá 403 em cascata.

### Fatia 3 — Adjust + Bonus (CRIAR L4/L5) · risco: médio · desbloqueia: gestão de limites/cortesias

- Nest: `POST /v1/licenses/:id/adjust` e `POST /v1/licenses/:id/bonus`
  (contratos §1.2) + testes de transição/audit.
- BFF: proxy fino (validação ≥10 chars permanece como defesa em profundidade).
- UI: sem mudança de contrato (`{machinesAllowed}`, `{bonusId}`).
- States: erro 422 (delta inválido / motivo curto) inline no formulário; sucesso
  com optimistic update revertido em erro; vazio N/A.

### Fatia 4 — Billing (CRIAR B1,B2-a,B4 + ADAPTAR B2,B3,B5) · risco: médio-alto · desbloqueia: faturas/assinaturas/reembolsos

- Nest primeiro (lists + `invoices/:id/payments`); B3 depende de B2-a.
- BFF: composição B2/B3 (§1.3); `amount_cents÷100`; `Idempotency-Key` já repassado.
- UI: lista com cursor infinito (mesmo `Page`); detalhe com aba Pagamentos
  (vazio = "sem pagamentos vinculados" — distinto de erro); refund/cancel
  mantêm modal motivo+confirmação.
- States: loading skeleton por linha da lista; erro 422 transição ilegal
  (`INVALID_TRANSITION`) com mensagem; 404 invoice; lista vazia com CTA de filtro
  ("limpar filtros").

### Fatia 5 — Finance núcleo (ADAPTAR F1–F6 + CRIAR F8) · risco: alto (dinheiro) · desbloqueia: KPIs, extratos, baixas

- BFF: overview→summary (cents÷100, `INADIMPLENTE→VENCIDO`), kind map, paginação
  em memória, settle→mark-*(com resolução de `account_id` — novo 422
  `ACCOUNT_REQUIRED`), `x-org-id`+`x-finance-read` sempre.
- Nest: só F8 (`facets`); resto existe.
- UI: `StaleBanner` apagado quando `isStale:false` (marco visível da virada);
  settle exige modal motivo+confirmação (já existe) + seletor de conta se
  `ACCOUNT_REQUIRED`.
- States: 403 sem `finance.read` → tela "sem acesso" (não lista vazia!);
  loading KPIs com shimmer; extrato vazio ≠ erro; settle idempotente (re-clique
  seguro via `Idempotency-Key`).

### Fatia 6 — Projeções, rastro, exports, audit, filas (ADAPTAR F7,Q1,Q2 + CRIAR B6,B7,F9,F10) · risco: baixo-médio · desbloqueia: paridade total

- Nest: `audit/events`, `billing/export`, `finance/export`, `finance/trace`,
  (facets já veio na 5). F7 usa projections existentes (polling `jobs/:jobId`
  via novo repasse BFF `GET /api/finance/projection/job/:id`).
- BFF: reagrupamento semanal F7, agregação Q1, CSV passthrough B7/F10.
- UI: projeção MISS → spinner "computando" + polling (não erro); trace interim
  MOCK até B6; exports disparam download; DLQ exibe `mode:logical` ("replay
  lógico — sem re-enqueue real" — honestidade sobre `dlq.controller.ts:76`).
- States: export 403 sem `*.manage`; DLQ vazia = "sem itens" (sucesso, não
  vazio de erro); audit vazio com filtros → sugerir ampliar período.

### Dependências entre fatias

`1 → (2,3) → 4 → 5 → 6`, com `B6 ⊂ 6` pré-requisito de `F9`.
`upstreamHeaders` (§0) sai na fatia 1 e serve todas. Nenhuma fatia remove mocks
— a remoção (`TODO backend pronto`) é uma fatia 7 de limpeza, após paridade
validada em staging com a flag ligada.
