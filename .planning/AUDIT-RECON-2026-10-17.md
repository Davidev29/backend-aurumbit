# Relatório de Auditoria Multiagente — Reconhecimento de Terreno

**Projeto:** Aurum Bit (monorepo "BACKEND SISTEMICO")
**Data:** 2026-10-17
**Modo:** Mapeamento e reconhecimento (sem modificação de código)
**Coordenador:** agente principal (20 subagentes especialistas em paralelo)
**Escopo:** apps (api, workers, admin, portal) + libs (8) + prisma (9 schemas) + deploy + docs

---

## 1. Sumário executivo

- **Terreno mapeado:** monorepo pnpm+turbo, NestJS 11 (API) + BullMQ workers + 2 frontends Next.js 14 (admin/portal) + 8 libs + Prisma (9 schemas PostgreSQL) + PgBouncer + Redis + Caddy.
- **Volume:** 543 arquivos `.ts` (apps+libs), ~73k linhas; 2213 arquivos versionados.
- **20 subagentes** de reconhecimento executados em paralelo (debug, backend, segurança, performance, infra, dados, frontend, libs).
- **Achados consolidados:** ~130 (após deduplicação cross-cutting), distribuídos:
  - **P0 (críticos):** 12
  - **P1 (altos):** 34
  - **P2 (médios):** 52
  - **P3 (baixos/info):** 32
- **Risco dominante:** segurança de autorização (RBAC por header spoofável, IDOR, BFF fail-open em prod, segredo JWT default) + Next.js 14.2.35 com CVEs de RCE.
- **Risco de performance dominante:** N+1 em catálogo/plans e admin billing, Maps in-memory sem evicção (support, customers, access cache), outbox in-memory ilimitado, tickers de worker sem guard de sobreposição.
- **Risco de correção dominante:** outbox relay sem transação (lock liberado antes do mark), worker de billing/fanout não wired (pipeline parado), worker de comms stub, DLQ não re-enfileira, projeções financeiras com DDL divergente.

> Esta etapa é **somente reconhecimento**. Nenhum arquivo foi alterado. As correções são propostas na seção 9.

---

## 2. Mapa do terreno

### 2.1 Arquitetura (resumo)
```
Produtos (Win/Mac/Web/App)
  → HTTPS / check-access / heartbeat / offline-token
API NestJS apps/api (:3000, /v1) → JWT 15min + refresh rotativo + guards
  → Prisma/pg pools por domínio → Postgres aurumbit (9 schemas) + PgBouncer :6432
  → Redis :6379 (BullMQ + cache 60s)
  → Workers apps/workers (consumers + crons; HTTP interno x-internal-key)
  → Admin Next.js apps/admin (:3001) BFF httpOnly proxy
  → Portal Next.js apps/portal (:3002)
```
- **Schemas PG:** auth, customers, products, access, licensing, billing, finance, audit, communications.
- **Filas BullMQ:** licensing.evaluate (5min), licensing.sync, licensing.dlq, billing.webhook.apply, billing.dlq, billing.recon (1h + daily 03:00 SP), billing.fanout, billing.fanout.dlq, finance.sync, finance.dlq, finance.projection.compute, comm.email.send, relay ticker 30s, invalidação 60min.
- **Outbox por domínio:** mesma txn insere `outbox_events`; relay `SKIP LOCKED LIMIT 100` publica BullMQ `jobId=eventId`.
- **Fluxo canônico compra:** Order → Invoice pending → Asaas charge → webhook RECEIVED → VALIDATED → APPLIED → Payment CONFIRMED → outbox PaymentConfirmed → fanout → access/licensing/finance/email.

### 2.2 Apps e libs
| Componente | Stack | Papel |
|---|---|---|
| `apps/api` | NestJS 11, pg, ioredis, zod, helmet, pino | Monólito modular, /v1 |
| `apps/workers` | Node, BullMQ | Consumers + crons |
| `apps/admin` | Next.js 14 | BFF httpOnly, gestão |
| `apps/portal` | Next.js 14 | Landing + área cliente |
| `libs/asaas-adapter` | TS | Adaptador Asaas |
| `libs/resend-adapter` | TS | Adaptador Resend/Svix |
| `libs/contracts` | zod | Contratos HTTP |
| `libs/events` | TS | Envelope de eventos |
| `libs/database` | Prisma | Factory (não consumida em runtime) |
| `libs/observability` | pino, OTel stub | Logger, métricas, health, tracing |
| `libs/offline-token` | TS | Offline JWT (dormente) |
| `libs/security` | argon2/scrypt | Hash, masking, rate-limit |
| `prisma/*` | Prisma | 9 schemas + migrations |

### 2.3 Testes (segundo docs)
- Unit: 475/475; e2e: 42/42; builds api/workers/admin PASS.

---

## 3. Metodologia

20 subagentes `explore` executados em paralelo, cada um com escopo delimitado e instrução de **não modificar arquivos**. Escopos:

1. API auth/access/customers/products + common auth/guards
2. API licensing/devices/offline/reveal/clone
3. API billing/Asaas/webhooks/recon/outbox/fanout
4. API finance/projections/balance/transactions
5. API communications/Resend/Svix
6. API audit/retention/support/admin/DLQ/health
7. API common (guards/filters/interceptors/rate-limit/outbox/http)
8. Workers (queues/crons/consumers)
9. Admin (Next BFF/mocks/middleware)
10. Portal (Next frontend)
11. libs/database + prisma schemas
12. libs/security + libs/observability
13. libs/contracts + libs/events
14. libs/asaas-adapter + libs/resend-adapter
15. libs/offline-token
16. Prisma schemas/migrations/indexes (deep)
17. Deploy/docker/compose/pgbouncer/redis
18. Performance hotspots cross-cutting
19. Segurança deep-dive cross-cutting
20. (relançado) Portal (correção de typo no primeiro batch)

Cada subagente entregou: arquivos-chave, fluxos críticos, tabela de achados (ID, severidade, arquivo:linha, descrição, impacto, recomendação). Este relatório consolida e deduplica.

---

## 4. Achados consolidados por severidade

### 4.1 P0 — Críticos (exploração direta / escalação / RCE)

| ID | Área | Evidência | Descrição | Impacto |
|---|---|---|---|---|
| P0-01 | Segurança/RBAC | `apps/api/src/modules/{products,access,licensing}/admin.guard.ts`, `admin/dlq-admin.guard.ts`, `finance/finance-read.guard.ts`, `projections.guard.ts` | `AdminStubGuard` aceita header `x-role: admin` forjável; bypass total de RBAC em contratos/bônus/entitlements/produtos/planos/licenças/DLQ/finance. | Escalação de privilégio total |
| P0-02 | Segurança/IDOR | `apps/api/src/modules/customers/customers.controller.ts:25-41` | Identidade tomada de header `x-identity-id` sem JWT; personificação de qualquer identity/org; alteração de memberships/consents/GDPR. | IDOR / takeover de conta |
| P0-03 | Segurança/BFF | `apps/admin/app/api/auth/login/route.ts:68-81`, `refresh/route.ts`, `me/route.ts` | Ramo stub aceita qualquer email/senha e emite `stub-session-*` sem guard de produção; fail-open em prod sem `API_INTERNAL_URL`. | Auth bypass em produção |
| P0-04 | Segurança/JWT | `apps/api/src/modules/auth/auth.module.ts:20`, `auth.service.ts:67-71`, `common/auth/jwt.service.ts:28-31` | Fallback `'dev-only-insecure-secret'` e `JWT_SECRET` default de teste; sem fail-fast em prod. | Forja de tokens |
| P0-05 | Segurança/Dependências | `apps/admin/package.json`, `apps/portal/package.json` (next@14.2.35); `pnpm audit` | CVEs GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4 (RCE não autenticado em Next.js). | RCE em admin/portal |
| P0-06 | Segurança/Auth | `apps/api/src/modules/access/access.controller.ts:5-21` | `check`/`check-batch` públicos (TODO service-token); vaza entitlements e permite enumeração. | Vazamento de direitos |
| P0-07 | Segurança/Admin | `apps/admin/middleware.ts:12-14` | `ADMIN_DEV_OPEN=1` desliga todos os gates sem checar `NODE_ENV`. | Acesso total se env vazar |
| P0-08 | Segurança/Finance | `apps/api/src/modules/billing/billing.controller.ts` (create/cancel/refund/confirm sem guard) | Qualquer autenticado cria/cancela faturas e registra pagamentos. | Fraude financeira |
| P0-09 | Segurança/Finance | `apps/api/src/modules/finance/finance-read.guard.ts:47-50` | Admin stub endereça qualquer org via query/body (IDOR de organização). | Acesso cross-org |
| P0-10 | Segurança/Finance | `apps/api/src/modules/finance/finance.service.ts:225-237,364-375` | `markReceived`/`markPaid` não atômicos → duplicidade de Transaction e saldo (race). | Perda financeira |
| P0-11 | Segurança/Billing | `apps/api/src/common/outbox/outbox-relay.ts:56-62,93-111` | Claim `FOR UPDATE SKIP LOCKED` fora de transação → lock liberado antes do mark; republicação duplicada. | Duplicação de eventos/fanout |
| P0-12 | Segurança/Workers | `apps/workers/src/main.ts:395-409` | Ticker de relay usa DB/queue no-op → outbox nunca drenado em produção. | Pipeline parado (eventos de domínio não publicados) |

---

### 4.2 P1 — Altos

| ID | Área | Evidência | Descrição |
|---|---|---|---|
| P1-01 | Auth | `auth.service.ts:180-210` | Lockout não atômico (read-modify-write); concorrência ultrapassa limite. |
| P1-02 | Auth | `auth.service.ts:230-277` | Refresh rotation sem lock pessimista → race/reuse de refresh token. |
| P1-03 | Auth | `auth/crypto.ts:278` vs `common/auth/jwt.service.ts:111` | Duas implementações JWT com claims divergentes (`mfa` vs `amr`); MFA step-up não aplicado. |
| P1-04 | Auth | `common/guards/membership-lookup.port.ts:28-46` + `guards.module.ts:38` | `MEMBERSHIP_LOOKUP` é InMemory em prod → escopo de org inoperante. |
| P1-05 | Auth | `auth/rate-limit.ts:47`, `global-rate-limit.guard.ts:52` | `MemoryBucket` sem TTL/limpeza → leak + não distribuído (bypass em escala). |
| P1-06 | Auth | `auth.service.ts:366-390,513-523` | Loops síncronos por sessão (N+1) em reset/change/anonymize. |
| P1-07 | Access | `access-check.service.ts:10,24` | `JSON.parse` em hot path + cache em memória sem bound (leak). |
| P1-08 | Access | `access-check.service.ts:39` | `checkBatch` dispara até 50 checks em paralelo sem limite de concorrência. |
| P1-09 | Access | `access/sync.service.ts:118-167` | `handleEnvelope` sem transação → estado inconsistente em falha parcial. |
| P1-10 | Access | `access/admin.guard.ts` + `access-admin.controller.ts:19` | Admin surface sem ator real; `actor`/`grantedBy` do body (mass assignment de auditoria). |
| P1-11 | Customers | `customers/customers.service.ts:31-102` | Store in-memory com scans O(n); sem paginação; não escala. |
| P1-12 | Customers | `customers/customers.service.ts:45` | Outbox em memória ilimitado (leak). |
| P1-13 | Products | `products/plans.service.ts:97-115` | `listPlans` → `toPlanView` por plano → `loadFeatures` N+1. |
| P1-14 | Products | `products/product-images.service.ts:105-123` | `getProduct` faz 2 queries; N+1 em listagem. |
| P1-15 | Products | `products/products.controller.ts:24-27` | `allPlans()` sem paginação/limit. |
| P1-16 | Licensing | `devices.service.ts:426-427` | `rotateDevice` não valida status da licença → device active em licença revogada. |
| P1-17 | Licensing | `devices.service.ts:348` | Bypass de limite quando hash já existe com status rotated/unlinked. |
| P1-18 | Licensing | `offline-token.service.ts:45-148` | `mint` sem transação/lock; `ctr` não atômico (race). |
| P1-19 | Licensing | `devices.service.ts:294-340` + controllers | Contagem de máquinas PROMO usa `opts.ip` do cliente (spoof). |
| P1-20 | Licensing | `libs/offline-token` vs `offline-jwt.ts` | Lib canônica não suporta canais (Fase 8); apps/api divergiu. |
| P1-21 | Licensing | `reveal.guard.ts:12-28` | Bucket singleton em memória (não distribuído) + Map sem cleanup. |
| P1-22 | Billing | `webhook.service.ts:199-216` | `receive` faz `await queue.add` antes do ack (Redis pode violar <2s). |
| P1-23 | Billing | `webhook.service.ts:179-184` | `payloadJson` persiste body completo (DoS/memória). |
| P1-24 | Billing | `webhook.transitions.ts:78-101` | Allowlist IP vazia = allow (fail-open); `X-Forwarded-For` spoof. |
| P1-25 | Billing | `webhook.controller.ts:42`, `billing.controller.ts:170-181` | Comparação de chave interna `!==` (não timing-safe). |
| P1-26 | Billing | `reconcile.service.ts:138-222` | Recon N chamadas remotas + N+1 SELECT por pagamento; paginação OFFSET. |
| P1-27 | Billing | `workers/main.ts:183-206` | Worker da fila `billing.webhook.apply` usa handler no-op; `PaymentApplyPort` não conectado. |
| P1-28 | Billing | `workers/main.ts:168-181` | Worker de comms é stub (fila `'communications.send'` em vez de `comm.email.send`). |
| P1-29 | Billing | `billing-flow.service.ts:99-110` + controller | Serviço in-memory com arrays/Maps/Sets sem limite + endpoint mock público. |
| P1-30 | Finance | `finance.service.ts:226,365` | `idempotencyKey` opcional com `randomUUID()` → retries não deduplicam. |
| P1-31 | Finance | `finance.service.ts:159-184,305-326` | `createReceivable`/`createPayable` SELECT+INSERT não atômico → 23505. |
| P1-32 | Finance | `finance-read.guard.ts:47-59`, `admin.guard.ts:8-15` | Guards confiam em headers `x-role`/`x-org-id`/`x-finance-read`. |
| P1-33 | Finance | `finance.controller.ts:75-77` | `active_only` ignorado em `listCategories`. |
| P1-34 | Finance | `finance-flow.service.ts:321-337` | Balance/transactions percorrem todos os registros em memória (O(n)). |

---

### 4.3 P2 — Médios (hardening / defesa em profundidade)

Agrupados por área; detalhes nos relatórios dos subagentes.

**Auth/Access/Customers/Products (12):** F-007 (JWT claims divergentes), F-008 (membership in-memory), F-010 (cache parse + leak), F-011 (batch sem limite), F-012 (sync sem txn), F-013 (loops N+1), F-014 (customers in-memory), F-015 (plans N+1), F-016 (product images 2 queries), F-017 (rate-limit leak), F-018 (cache Redis churn), F-019 (mass assignment actor), F-020 (mass assignment DTO).

**Licensing (12):** F-02 (bypass limite reativação), F-03 (mint sem txn), F-04 (IP spoof PROMO), F-05/F-06/F-07 (lib offline-token desync), F-08 (assinatura base64url), F-09 (2 sistemas de cifra), F-10 (label stub base64), F-11 (reveal bucket), F-12 (reveal actor por role), F-13 (rotate sem maxDevices), F-14 (validateOnline stale), F-15 (suspend/revoke race), F-16 (checkOffline não consulta device), F-17 (check permite device não vinculado), F-18 (reveal sem try/catch), F-19 (scryptSync bloqueia event loop), F-20 (DLQ in-memory), F-21 (deviceSecret fallback), F-22 (DTO duplicado), F-23 (re-link não atualiza lastSeenAt), F-24 (cloned_evidence regravado), F-25 (label decrypt lança).

**Billing/Finance (14):** B4 (payloadJson body completo), B5 (IP allowlist fail-open), B6 (chave interna não timing-safe), B7 (recon N+1), B8 (worker recon divergente), B9 (reconEventId inconsistente), B10 (SQL injection limit/table), B12 (confirmPayment race), B13 (in-memory unbounded + mock endpoint), B14 (cron setInterval sobreposição), B15 (métricas Noop), B16 (INTERNAL_WEBHOOK_KEY non-null), B17 (Redis error silenciado), B18 (applyRecon semântica), B19 (fanout sem validação de topic). Finance: F-05 (guards headers), F-06 (org scope do cliente), F-07 (list sem limit), F-08 (transactions sem offset), F-09 (balance O(n)), F-10 (snapshot in-memory stale), F-11 (active_only ignorado), F-12 (idempotencyKey global colisão), F-13 (endpoints internos 500), F-14 (jobs in-memory multi-instância), F-15 (projections source vazio), F-16 (sync subscription divergente), F-17 (índices compostos faltantes), F-18 (cache entitlement stale), F-19 (outbox relay SQL), F-20 (recompute sem try/catch).

**Communications (10):** A1 (Svix opcional), A2 (rawBody string vs Buffer), A3 (worker stub), A4 (DLQ nome errado), A5 (webhook 500), A6 (status regredir entre terminais), A7 (secretKey sem validação), A8 (redação só top-level), A9 (XSS href javascript:), A10 (fetch sem timeout), A11 (MemoryBucket sem cleanup), A12 (e-mail cru em outbox payload), A13 (tipos crus), A14 (DLQ fallbackData), A15 (upsert poison vs retryable).

**Audit/Retention/Support/Admin/Health (18):** A1 (audit em memória sem persistência/limite), A2 (tabela não schema-qualificada), A3 (cursor id sem índice), A4 (audit leitura só AdminStubGuard sem MFA), A5 (AuditInterceptor não registrado), A6 (list O(n)), R1 (dry-run superconta), R2 (batch interpolado SQL), R3 (purge 1 batch), R4 (métricas in-memory), R5 (conexões Redis leak), R6 (now app vs DB), S1 (support Maps sem limite), S2 (isStaffRequest qualquer JWT), S3 (token em query string SSE), S4 (list sem paginação), S5 (presence incorreto), S6 (sem backpressure SSE), S7 (Subject mutável exposto), D1 (DLQ replay lógico), D2 (DLQ in-memory), D3 (DLQ expõe data), D4 (actor por role), D5 (replay até 1000), D6 (service token bypassa MFA), H1 (health cria conexão por probe), H2 (DLQ depth impreciso), M1 (cardinalidade de rota), M2 (registry in-memory), M3 (contadores não incrementados), M4 (/metrics público).

**Libs (15):** security F2 (safeEqualHex não valida hex/length 0), F4 (redação top-level + ciclos), F5 (rate-limit in-memory + Map sem evicção + colisão de chave), F6 (presets duplicados/divergentes), F7 (logger redact incompleto + env imutável), F8 (correlation case-insensitive parcial), F9 (pick array), F10 (cardinalidade métricas), F11 (collectDefaultMetrics no import), F12 (tracing noop mesmo com endpoint), F13 (health sem timeout por dep), F14 (argon2 cache negativo), F15 (maskIp IPv6). contracts: consent sem unicidade, convite sem identityId/email, patch vazio, errorCode livre, device_hash sem formato, TrialIssue retorna chave plaintext, Plan sem validTo>validFrom, ApiError details sem redact, versionamento de evento. events: createEnvelope sem validação, envelopeOf não valida tópico/fixa version 1, sem limite de payload, sem redação PII, isEnvelope permissivo, randomUUID node-only, null→{} mascarando, adoption zero em runtime. asaas: retry em POST sem idempotency key, retry imediato (sem backoff), validação de payload, fuso UTC, sem circuit breaker, Retry-After ignorado, fetch sem limite, hasMore default, finance provider divergente/timeout NaN. resend: fetch sem timeout, baseUrl sem HTTPS check, Svix opcional, redação top-level, erro parse exposto, código morto, validação email fraca, rawBody fallback. offline-token: rotated device não implementado, claims sem schema, off_exp não recomputado, sem cap de tamanho, sem key resolution por kid, alg/typ não validados, timing-safe em base64url, checks opcionais fail-open, clock skew só iat, anti-replay só rollback, segredo sem força mínima, base64 leniente, iat alias, NaN vitalícia, sem testes.

**Deploy/Infra (14):** F1 (compose name divergente), F2 (CD path inexistente), F3 (fallbacks dev em prod), F4 (Redis sem maxmemory), F5 (PgBouncer max_db_connections < soma pools), F6 (alertas sem receiver/Prometheus), F7 (admin sem rate-limit/IP allowlist no edge), F8 (caddy não depende de portal), F9 (workers healthcheck node --version), F10 (pgbouncer sem healthcheck), F11 (pre-dns-check 200 em /), F12 (seed-prod SQL injection), F13 (license master key como dir), F14 (audit-partition com URL pgbouncer), F15 (HSTS sem preload), F16 (backup sem trap ERR), F17 (grants sequences faltantes), F18 (dir 0700), F19 (gen-prod-env trap), F20 (sem CPU limits).

**Prisma/Dados (14):** DB-01 (ordenação de migration finance quebra migrate deploy), DB-02 (DDL projections divergente do Prisma), DB-03 (partições criadas por superuser → grants), DB-04 (scope @unique vs multi-snapshot), DB-05 (baselines criam schema public), DB-06 (XOR PF/PJ sem CHECK), DB-07 (license device onDelete drift), DB-08 (índice entitlements sem ownerType), DB-09 (outbox sem índice published/occurredAt), DB-10 (PK composta audit vs Prisma id), DB-11 (updatedAt vs storedAt duplicados), DB-12 (WebhookReceipt externalId sem provider), DB-13 (seed-prod SQL injection), DB-14 (security_events sem índice por actor/entity), DB-15 (unique nullable permite duplicatas), DB-16 (índice receivables/payables sem status), DB-17 (status como String sem CHECK), DB-18 (grants sequences faltantes), DB-19 (ADD CONSTRAINT não idempotente), DB-20 (finance automation sem search_path).

**Admin/Portal Frontend (16):** Admin: mock generalizado em prod (P1-?), CSP unsafe-inline, claims não atualizadas no refresh, logout sem flags, sem error boundaries/loading, bundle sem code splitting, imagens sem otimização, SSR/CSR waterfalls, cache público de imagem sem Vary, estado mutável global, sem logs/observabilidade, fetch sem timeout, polling frequente, apiFetch força Content-Type, localStorage com data URLs, HSTS sem preload, middleware matcher. Portal: P-01 (landing SSR usa mock em vez de fetchCatalogFromUpstream), P-02 (Toast não auto-remove), P-03 (token de chat em query string + localStorage), P-04 (SSE não reconecta), P-05 (IDOR dev isStaff=true em GET messages), P-06/P-07 (img sem next/image), P-08 (sem code splitting), P-09 (refetch silencioso), P-10 (getMe duplicado), P-11 (logout não revoga upstream), P-12 (me mock no login), P-13 (polling 10min), P-14 (stubs no-op de segurança), P-15 (hydrate antes da declaração), P-16 (filterCatalogPage sem guard), P-17 (listeners não removidos), P-18 (localhost em prod remotePatterns), P-19 (middleware só existência de cookie), P-20 (tema vidro só na landing).

**Performance (15):** N+1 plans (P1), fetch por customer sem limite/timeout (P1), support Maps sem limite (P1), customers outbox in-memory (P1), check-access cache sem evicção (P1), recon N+1 remoto (P2), workers tickers sem guard (P2), projections byIndex O(n×buckets) (P2), JSON.parse/stringify hot path (P2), JSON.stringify em logs por envelope (P2), license store in-memory (P2), fetch sem timeout BFF/admin/portal (P3), SSE sem backpressure (P3), client arrays sem cap (P3), Promise.all sem limite (P3).

---

### 4.4 P3 — Baixos / Informativos

Agrupados (contagem): Auth 6 (F-021..F-028), Licensing 9 (F-21..F-25 + observações), Billing 5 (B16..B19), Finance 4 (F-16..F-20), Communications 5 (A14..A18), Audit/Retention/Support 12 (A5,A6,R3,R4,R5,R6,S5,S6,S7,D5,D6,H2,M3,M4,P1..P3), Libs 12, Deploy 6, Portal/Admin 8, Performance 4. Total ~32 (estimativa; ver relatórios dos subagentes para detalhe individual).

---

## 5. Hotspots de performance (top priorizados)

1. **N+1 em catálogo de planos** — `apps/api/src/modules/products/plans.service.ts:114` (`Promise.all(rows.map(toPlanView))` → `loadFeatures` por plano). Impacto: latência de catálogo sob carga.
2. **Fetch por customer sem limite/timeout** — `apps/admin/lib/billing/map.ts:160-177` (`Promise.all` de N fetchs). Impacto: travamento de listagem admin.
3. **Memory leak em support** — `support.service.ts:99-103` (Maps de conversas/mensagens/streams/typing sem evicção). Impacto: OOM em long-running.
4. **Outbox in-memory ilimitado (customers)** — `customers.service.ts:45`. Impacto: crescimento contínuo.
5. **Check-access cache sem evicção** — `check-access-cache.service.ts:15` (TTL só no get). Impacto: cardinalidade alta.
6. **Reconciliação billing** — `reconcile.service.ts:140-222` (N chamadas remotas + N+1 SELECT). Impacto: janela de recon excedida.
7. **Workers tickers sem guard de sobreposição** — `workers/main.ts:390-413`. Impacto: execução concorrente de jobs longos.
8. **Projeções byIndex O(n×buckets)** — `projections.compute.ts:390-392`. Impacto: CPU em payloads grandes.
9. **JSON parse/stringify em hot path** — `access-check.service.ts:24,34`; `sync.service.ts` (logs). Impacto: GC pressure.
10. **License store in-memory ilimitado** — `license-store.ts:55-56` (fase dev). Impacto: memória.
11. **Fetch sem timeout (BFF/admin/portal)** — padrão amplo sem `AbortSignal`. Impacto: travamento.
12. **SSE sem backpressure** — `support.service.ts:319-330`. Impacto: memória em clients lentos.
13. **Promise.all sem limite** — access batch, admin names. Impacto: concorrência ilimitada.
14. **Arrays de mensagens sem cap (client)** — `support-client.ts:176`. Impacto: memória em sessão longa.
15. **Redis sem maxmemory** — `docker-compose.yml:61`. Impacto: OOM do Redis.

---

## 6. Segurança (top priorizados)

1. **RBAC por header spoofável** (P0-01) — todos os `admin.guard.ts` stubs.
2. **IDOR por header `x-identity-id`** (P0-02) — customers.
3. **BFF fail-open em prod** (P0-03) — admin login stub.
4. **Segredo JWT default** (P0-04) — auth module.
5. **Next.js 14.2.35 CVEs (RCE)** (P0-05) — admin/portal.
6. **Endpoints públicos de check-access** (P0-06).
7. **Admin dev open** (P0-07).
8. **Mutação financeira sem role** (P0-08).
9. **IDOR de organização em finance** (P0-09).
10. **Race em markReceived/markPaid** (P0-10).
11. **Webhook sem allowlist efetiva** (P1-24 / A9).
12. **Chave MFA derivada do JWT** (A10).
13. **Arquivamento default-allow** (A11).
14. **Rate-limit em memória + XFF spoof** (A14).
15. **Membership in-memory em prod** (A15).
16. **Host header injection (CSRF)** (A16).
17. **Comparação não constant-time (chave interna)** (A17).
18. **CORS default localhost** (A18).
19. **Senha política mínima** (A19).
20. **Argon2 opcional (fallback scrypt)** (A20).
21. **Upload SVG inline** (A13).
22. **DoS Next.js (moderate/high)** (A12).

---

## 7. Infra / Deploy

- **CD quebrado:** `cd-hml.yml`/`cd-prod.yml` referenciam `deploy/Dockerfile.api` inexistente (F2).
- **Compose name divergente:** base `aurum_bit_backend` vs caddy overlay `aurum` (F1) → volumes/containers órfãos ao habilitar edge.
- **Prod com fallbacks dev:** `${APP_*_PASSWORD:-dev_*_pw}` e `env_file required: false` (F3).
- **Redis sem maxmemory** (F4); **PgBouncer max_db_connections=100 < soma pools ~150** (F5).
- **Alertas sem receiver/Prometheus** (F6).
- **Admin sem rate-limit/IP allowlist no edge** (F7); **Caddy não depende de portal** (F8).
- **Workers healthcheck = `node --version`** (F9); **PgBouncer sem healthcheck** (F10).
- **pre-dns-check exige 200 em `/`** mas API usa prefixo `/v1` (F11).
- **seed-prod SQL injection** (F12); **license master key como diretório** (F13); **audit-partition com URL pgbouncer** (F14).
- **HSTS sem preload** (F15); **backup sem trap ERR** (F16); **grants sequences faltantes** (F17); **dir 0700** (F18); **gen-prod-env trap** (F19); **sem CPU limits** (F20).

---

## 8. Dados / Prisma

- **Migration finance quebra migrate deploy** (DB-01): ordenação lexicográfica aplica `0003` antes de `20261012000000` (automation), mas `0003` referencia `finance_automation_jobs`.
- **Projeções financeiras:** DDL do store diverge do Prisma (DB-02/DB-04): PK composta vs `id` PK + `scope @unique`.
- **Partições de audit:** criadas por superuser → grants não aplicados (DB-03).
- **Baselines criam schema `public`** em vez do schema de domínio (DB-05).
- **XOR PF/PJ sem CHECK** (DB-06); **license device onDelete drift** (DB-07).
- **Índices faltantes:** entitlements sem ownerType (DB-08); outbox sem (published, occurredAt) (DB-09); security_events sem índice por actor/entity (DB-14); receivables/payables sem status (DB-16).
- **Audit PK composta vs Prisma `id @id`** (DB-10); **updatedAt vs storedAt duplicados** (DB-11); **WebhookReceipt externalId sem provider** (DB-12); **unique nullable permite duplicatas** (DB-15); **status como String sem CHECK** (DB-17); **ADD CONSTRAINT não idempotente** (DB-19); **finance automation sem search_path** (DB-20).

---

## 9. Recomendações priorizadas (roadmap de correção)

### Fase 0 — Bloqueadores de produção (P0)
1. Remover/condicionar todos os `admin.guard.ts` stubs; implementar RBAC real (JWT→Session→Mfa→Roles→CustomerScope) e remover trust em `x-role`/`x-mfa`/`x-finance-read`/`x-org-id`/`x-identity-id`.
2. BFF admin fail-closed em prod (`isMockAllowed`/`resolveUpstream`); remover ramo stub de login/refresh/me.
3. Fail-fast de segredo JWT em prod; remover fallback `'dev-only-insecure-secret'` e default de teste.
4. Atualizar Next.js 14.2.35 → ≥15.5.24 (admin/portal) para fechar CVEs de RCE.
5. Corrigir CD (`deploy/Dockerfile.api` → `apps/api/Dockerfile`).
6. Corrigir ordenação de migration finance (DB-01).
7. Unificar DDL de projeções com Prisma (DB-02/DB-04).
8. Conectar worker de billing (handler real + `PaymentApplyPort`) e worker de comms (fila correta).
9. Injetar pools PG reais + filas BullMQ no ticker de outbox (workers/main.ts) — pipeline hoje parado.
10. Envolver claim+mark do outbox em transação (B1).
11. Tornar `markReceived`/`markPaid` atômicos (F-01/F-02 finance).
12. Corrigir BFF `x-role: admin` injection (upstream.ts) — derivar do JWT.

### Fase 1 — Segurança (P1)
- Membership lookup adaptador Prisma real.
- Rate-limit distribuído (Redis) com TTL/evicção; IP do proxy confiável.
- Webhook allowlist fail-closed (Asaas) + Svix obrigatório (Resend) em prod.
- Chave interna timing-safe; finance guards reais.
- MFA enc key dedicado + KDF.
- Upload SVG: Content-Disposition attachment ou bloqueio.
- Senha política mínima 12 + complexidade.
- Argon2 obrigatório em prod (fail-fast).
- CORS sem default localhost em prod.
- Host header validation no edge.
- Default-deny em arquivamento support.
- Membership in-memory → PG.

### Fase 2 — Performance (P1/P2)
- Batch de features em `PlansService.listPlans` (eliminar N+1).
- Limitar concorrência/timeout em `resolveCustomerNames` e BFF fetch.
- LRU/cap em Maps in-memory (support, customers, access cache) + outbox purge.
- Guard de sobreposição nos tickers do worker.
- Otimizar `byIndex` nas projeções.
- Redis maxmemory + allkeys-lru.
- PgBouncer max_db_connections ≥ soma pools.
- Índices: entitlements (ownerType), outbox (published, occurredAt), security_events (actor, entity), receivables/payables (status, dueDate).
- Health probes usando pool existente (não nova conexão).

### Fase 3 — Correção/robustez (P2)
- DLQ persistente + re-enfileiramento real.
- Support: evicção/TTL, paginação, backpressure SSE, presence real.
- Audit: persistência PG, schema-qualificação, MFA na leitura, registrar AuditInterceptor.
- Retention: alinhar dry-run vs purge, loop de batches, métricas no Prometheus.
- Communications: worker real, DLQ nome correto, Svix rawBody, redação recursiva, XSS href.
- Licensing: mint transacional, rotate valida status/maxDevices, lib offline-token sincronizada, reveal try/catch, scrypt async.
- Finance: idempotency key obrigatória, create receivable/payable atômico, active_only, list com offset, balance agregado, projections source real, sync subscription unificado.
- Billing: recon sem N+1, reconEventId determinístico, applyRecon semântica, fanout valida topic, cron sem sobreposição.
- Prisma: baselines com CREATE SCHEMA, XOR CHECK, license device onDelete alinhado, WebhookReceipt unique (provider, externalId), audit PK documentada/índice auxiliar, status CHECK, ADD CONSTRAINT idempotente, finance automation search_path.
- Deploy: compose name, healthchecks (workers, pgbouncer), pre-dns-check /health/live, seed-prod parametrizado, license master key arquivo, audit-partition URL direta, HSTS preload, backup trap ERR, grants sequences, dir 0700, gen-prod-env trap, CPU limits, Redis maxmemory, alertas com receiver/Prometheus.

### Fase 4 — Qualidade/observabilidade
- Integrar libs/contracts e libs/events no runtime (eliminar drift).
- Adicionar testes em libs (contracts, events, offline-token, asaas-adapter).
- Consolidar implementações de segurança (libs/security como fonte única).
- Cardinalidade de métricas (allowlist de route/action).
- Tracing real (NodeSDK + OTLP) quando endpoint configurado.
- CSP com nonce (remover unsafe-inline).
- Code splitting (admin/portal) + next/image.
- Portal: SSR catálogo real, Toast auto-remove, SSE reconnect, logout revoga upstream, code splitting, guards em filterCatalogPage.

---

## 10. Limitações

- Auditoria **estática** (sem execução de testes/exploits, sem inspeção de dados de produção ou secrets).
- Stubs documentados como "TODO RBAC real" tratados como risco real quando expostos via headers controláveis pelo cliente.
- Métricas de contagem de achados são estimativas após deduplicação manual; os relatórios dos subagentes contêm o detalhe individual (IDs por área).
- Nenhum arquivo foi modificado nesta etapa (reconhecimento puro).

---

## 11. Apêndice — Inventário de subagentes

| # | Escopo | Status |
|---|---|---|
| 1 | API auth/access/customers/products + common | OK |
| 2 | API licensing/devices/offline/reveal/clone | OK |
| 3 | API billing/Asaas/webhooks/recon/outbox/fanout | OK |
| 4 | API finance/projections/balance/transactions | OK |
| 5 | API communications/Resend/Svix | OK |
| 6 | API audit/retention/support/admin/DLQ/health | OK |
| 7 | API common (guards/filters/interceptors/rate-limit/outbox/http) | OK |
| 8 | Workers (queues/crons/consumers) | OK |
| 9 | Admin (Next BFF/mocks/middleware) | OK |
| 10 | Portal (Next frontend) | OK (relançado) |
| 11 | libs/database + prisma schemas | OK |
| 12 | libs/security + libs/observability | OK |
| 13 | libs/contracts + libs/events | OK |
| 14 | libs/asaas-adapter + libs/resend-adapter | OK |
| 15 | libs/offline-token | OK |
| 16 | Prisma schemas/migrations/indexes (deep) | OK |
| 17 | Deploy/docker/compose/pgbouncer/redis | OK |
| 18 | Performance hotspots cross-cutting | OK |
| 19 | Segurança deep-dive cross-cutting | OK |
| 20 | (contagem incluída acima) | OK |

**Relatório gerado em:** `.planning/AUDIT-RECON-2026-10-17.md`
**Fontes de autoridade consultadas:** `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/SLOs.md`, `docs/LGPD.md`, `docs/ADR-001..006`, código-fonte dos apps/libs/prisma/deploy.