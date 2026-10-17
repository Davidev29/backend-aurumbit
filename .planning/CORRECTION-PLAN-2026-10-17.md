# Plano de Correção — Fluxo Agêntico (Onda 2 → 3 → 4)

**Projeto:** Aurum Bit · **Data:** 2026-10-17
**Origem:** auditoria multiagente (recon) + auditoria adversarial de verificação (2 ondas, 10 agentes)
**Baseline capturado:** `typecheck` 7/7 ✅ · `jest apps/api` 49 suites / 485 testes ✅

---

## 0. Como ler este documento

Três ondas de execução, cada uma com gate de verificação próprio:

| Onda | Natureza | Risco | Gate |
|---|---|---|---|
| **Onda 2 — Correção** | Subagentes aplicam correções isoladas | Médio por lote | typecheck + 485 testes + e2e (mando rodar) |
| **Onda 3 — Verificação** | Conferência ponto a ponto de cada item alterado | Baixo (read-only) | Checklist por item + evidência `arquivo:linha` |
| **Onda 4 — Conformidade** | Prova de não-regressão + gaps de teste | Baixo | Baseline comparado |

**Regra de ouro:** nenhum item entra na Onda 3 sem o subagente que o alterou declarar `arquivo:linha` exatos. Item sem prova volta para a Onda 2.

---

## 1. Resultado da auditoria adversarial — 8 claims REFUTADOS

O recon errou. Registrado para não repetir:

| # | Claim do recon | Veredito real | Por quê |
|---|---|---|---|
| R1 | `JWT_SECRET` sem fail-fast em prod | **REFUTADO** | O fail-fast **existe** (`jwt.service.ts:29-31`) — o recon citou essas mesmas linhas como prova de ausência. E o fallback `'dev-only-insecure-secret'` é **inalcançável** (zod escreve o default em `process.env` antes dos providers). |
| R2 | MFA bypass (claims `mfa` vs `amr`) | **REFUTADO** | Guard **nega** (fail-closed): `amr=[]` → 403 `MFA_REQUIRED`. O risco real é outro: **nenhuma rota usa `@RequireMfa()`**. |
| R3 | `safeEqualHex` vulnerável em `apps/api` | **REFUTADO** | A versão do api tem guard de length-0 e **zero call sites**. A vulnerável é a de `libs/security`. |
| R4 | `access/check` é público | **REFUTADO** | Não tem `@Public()` — exige JWT. |
| R5 | rotateDevice bypassa maxDevices | **REFUTADO** | `linkDevice:262` faz `FOR UPDATE` na licença **antes** do COUNT — serializa. |
| R6 | markReceived/markPaid duplica (mesma chave) | **REFUTADO** | `UNIQUE(idempotencyKey)` + `ON CONFLICT DO NOTHING` + `ROLLBACK` explícito. O bug real exige **chaves diferentes**. |
| R7 | Recon N+1 / projections byIndex são custo | **REFUTADO** | Ambos são **código morto**: `MissingReconcileAsaasPort` lança; `InMemoryProjectionSource` devolve `EMPTY`. 0 chamadas. |
| R8 | Next.js 14.2.35 = RCE não autenticado | **REFUTADO** | GHSA-p293 é **só Windows** (deploy é `node:20-alpine`). GHSA-2xp9 exige **`sharp`**, que não está instalado → otimizador retorna 500 antes de decodificar. |

## 2. Achados NOVOS, mais graves que os originais

| # | Achado | Evidência |
|---|---|---|
| **N1** | **`apps/api` não declara `bullmq`.** As 4 factories fazem `require('bullmq')` em try/catch → caem silenciosamente em fila in-memory. A API **nunca enfileira nada** em produção. | `apps/api/package.json` (sem bullmq); `apps/api/node_modules/bullmq` ausente; `webhook.queue.ts:79-112`; mesmo bug em `sync.queue.ts`, `projections.queue.ts`, `finance-automation.queue.ts`, `retention.cron.ts` |
| **N2** | **Pipeline de billing tem 3 cortes consecutivos:** produtor não enfileira → handler registrado só loga → `PaymentApplyPort` nunca conectado. `payments.status` **nunca** vira `CONFIRMED`. | `workers/main.ts:187-206`; `billing.apply.ts:154` ("não é importado lá hoje"); `webhook.service.ts:287-302` |
| **N3** | **`billing.controller.ts`: 8 POSTs financeiros com ZERO guard de autorização** (invoices, cancel, subscriptions, payments, confirm, refund, checkout). Pior que o header forjável. | `billing.controller.ts:25,40,78,83,113,126,131,151` |
| **N4** | **`devices.controller.ts`: 4 rotas de escrita sem guard** — qualquer autenticado altera devices de qualquer `licenseId`. | `devices.controller.ts:63,77,91,110` |
| **N5** | **Rate-limit 100% burlável**: sem `trust proxy`, lê `x-forwarded-for` **antes** de `req.ip`. Rotacionar o header = chave nova = todos os presets viram ilimitados. | `global-rate-limit.guard.ts:61-67`; `main.ts` sem `set('trust proxy')` |
| **N6** | **OOM trivial**: `MemoryBucket` sem evicção + espaço de chaves controlado pelo atacante (XFF, `body.email`, `x-actor-id`). `mem_limit: 1g`. | `global-rate-limit.guard.ts:33,62,69,77` |
| **N7** | **Sem graceful shutdown na API**: sem `enableShutdownHooks()`, sem SIGTERM, sem `stop_grace_period`, sem `init: true` (zombies). | `main.ts` (49 linhas); grep `stop_grace_period\|init:` nos 3 compose = 0 |
| **N8** | **1 query de sessão por request autenticado**, sem cache, em `Pool` privado sem `max`/timeout (`connect_timeout=0` = espera infinita). **Dois pools duplicados** na mesma `DATABASE_URL_AUTH`. | `session.guard.ts:19`; `pg-session-lookup.ts:21`; `auth.repository.ts:289` |
| **N9** | **`TROCAR_*` passa a validação**: `.env.example:91` tem 39 chars, passa `min(16)`, e é aceito como segredo real. Prod sobe com segredo público do repo. | `env.schema.ts:43` (sem rejeição de placeholder); comparação: `libs/asaas-adapter/src/config.ts:41` **é** fail-fast |
| **N10** | **`env_file required: false` em 8 serviços** → prod pode subir com `dev_*_pw` se `../.env` faltar. | `docker-compose.prod.yml:93,133,164,188,218` |
| **N11** | **`name` do compose divergente**: `base+prod` = `aurum_bit_backend`; `+caddy` = `aurum`. Alternar → volumes órfãos → **Postgres recriado vazio** (aparência de perda total). | `docker-compose.yml:6` vs `docker-compose.caddy.yml:21` (provado com `docker compose config`) |
| **N12** | **`migrate resolve --applied 0001_baseline` incondicional**: se o init falhou, `audit_events` nunca existe e o deploy reporta **verde**. | `migrate-all.sh:46-52` |
| **N13** | **Limite de conexão dos roles estoura**: `app_customers`/`app_products`/`app_billing`/`app_communications` têm `LIMIT 15` mas pedem 15×2=30. `app_auth` 30 vs 40. → `too many connections for role` sob carga. | `init-consolidated.sql:58-91` vs `docker-compose.yml:126-137` |
| **N14** | **Projeções de finance sempre 500** em DB migrado: store omite `id`, mas a coluna é `NOT NULL` sem DEFAULT. | `projections.store.ts:146-151` vs `prisma/finance/.../0001_baseline:126,142` |
| **N15** | **CI/CD quebrado**: `cd-hml.yml:40` / `cd-prod.yml:51` apontam `deploy/Dockerfile.api` **inexistente**. Falha dura, cascateia migrate→deploy→smoke. Invisível ao `ci.yml`. | `.github/workflows/cd-*.yml` |
| **N16** | **7 e2e specs são código morto**: `turbo run test` só vê `src/`, nunca `test/`. A cadeia de guards **não tem verificação nenhuma** em CI. | `.github/workflows/ci.yml:77`; `apps/api/package.json:54-55` (`rootDir: src`) |
| **N17** | **`apps/api` não tem script `typecheck`.** O "typecheck 7/7" cobre **só libs/** — que a API **nem importa**. | `turbo run typecheck --dry` → 7 workspaces, todas libs |
| **N18** | **`customers.service` LIVE em prod sem adapter PG** — mas o seed grava `customer_profiles` direto no PG → `GET /customers/me` devolve **404** para o admin semeado. | `app.module.ts:58`; `deploy/scripts/seed-prod.sh:117` |
| **N19** | **`support.service` sem evicção + `@Public()` sem rate limit** → 1 req/s = ~700 MB em 24h; 10 req/s = ~7 GB → OOM. LIVE. | `support.service.ts:99-103`; `support.controller.ts:68-69` |
| **N20** | **`resolveCustomerNames`: 21 HTTP por página, 101 por export, sem timeout.** 1 fetch lento trava a rota inteira. | `apps/admin/lib/billing/map.ts:160-177` |
| **N21** | **2 CRITICAL em `tinypool`** (prototype pollution → RCE) via `vitest@3`. DEV/CI only, mas é supply chain de CI. | `pnpm audit`: GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr |
| **N22** | **`.trivyignore` mascara 10 advisories Next** até 2027-01-15 (todas ativas hoje). Justificativa do AVIF está **factualmente errada**. | `.trivyignore:4-14` |
| **N23** | **`pre-dns-check.sh` exige 200 em `/`** mas a API só tem `/v1/*` + `/health/*` → gate permanentemente vermelho. | `pre-dns-check.sh:32-35` vs `main.ts:38` |
| **N24** | **`audit-partition.sh` roda DDL como role de app via PgBouncer** → `permission denied`; `migrate-all.sh` engole com `|| echo WARN`. Partições nunca criadas pelo deploy. | `audit-partition.sh:28-46`; `init-consolidated.sql:248` |

---

## 3. Onda 2 — Correção (ordenada por risco x reversibilidade)

### Lote 0 — Bloqueadores de deploy (reversível, baixo risco, sem regra de negócio)
| ID | Ação | Arquivo | Agente |
|---|---|---|---|
| D0-1 | Corrigir path do Dockerfile no CD | `.github/workflows/cd-hml.yml:40`, `cd-prod.yml:51` | infra |
| D0-2 | `migrate resolve --applied` só se a tabela existir | `deploy/scripts/migrate-all.sh:46-52` | dados |
| D0-3 | `audit-partition.sh` usar `MIGRATOR_DATABASE_URL` (direto, 5432) | `deploy/scripts/audit-partition.sh:28-42` | dados |
| D0-4 | `pre-dns-check.sh` usar `/health/live` para host api | `deploy/scripts/pre-dns-check.sh:32-35` | infra |
| D0-5 | `ProjectionSnapshot`: store e Prisma coerentes (id com default OU remover `id`) | `projections.store.ts:146-151`, `prisma/finance/schema.prisma:223` | dados |

### Lote 1 — Correção Financeira Idempotente (alto valor, baixo risco)
| ID | Ação | Arquivo | Agente |
|---|---|---|---|
| D1-1 | `UPDATE receivables` com guarda `AND status <> 'RECEBIDO'` | `finance.service.ts:252` | backend-finance |
| D1-2 | Idem `payables` | `finance.service.ts:390` | backend-finance |
| D1-3 | `Idempotency-Key` obrigatório (min 8) em mark-*, sem `randomUUID()` | `finance.service.ts:226,365` + dto | backend-finance |
| D1-4 | `confirmPayment`: guarda de status na cláusula `WHERE` + checar `rowCount` | `billing.service.ts:650-652` | backend-billing |
| D1-5 | `eventId` determinístico em `confirmPayment` (hash de payment+transition, não `randomUUID`) | `billing.service.ts:770` | backend-billing |

### Lote 2 — Auth: rotação atômica + chave de MFA (médio risco)
| ID | Ação | Arquivo | Agente |
|---|---|---|---|
| D2-1 | `updateRefreshToken` de rotação: `WHERE id=$3 AND status='ACTIVE'`, checar `rowCount===1` | `auth.service.ts:266`, `auth.repository.ts:443` | backend-auth |
| D2-2 | Lockout: `failed_attempts = failed_attempts + 1 WHERE ... AND failed_attempts < $n` | `auth.service.ts:154-161` | backend-auth |
| D2-3 | `MFA_ENC_KEY` obrigatório em prod + rejeitar placeholder `TROCAR_*`/`changeme` no `env.schema.ts` | `auth.service.ts:73-77`, `env.schema.ts` | backend-auth |
| D2-4 | `JWT_SECRET`/`AUTH_JWT_SECRET`: rejeitar `TROCAR_*` e o default de teste | `env.schema.ts:43,56-80` | backend-auth |
| D2-5 | Pool compartilhado `AUTH_POOL` com `max`/`idleTimeoutMillis`/`connectionTimeoutMillis` (elimina os 2 pools duplicados) | `auth.repository.ts:289`, `pg-session-lookup.ts:21` | backend-auth |
| D2-6 | `?schema=`/`connection_limit=` na URL são **no-op no `pg`** → passar `search_path` via provider | pools em `auth.repository.ts` | backend-auth |

### Lote 3 — Rate-limit + shutdown (risco de disponibilidade — requer atenção)
| ID | Ação | Arquivo | Agente |
|---|---|---|---|
| D3-1 | `set('trust proxy', 1)` **ou** parar de ler `x-forwarded-for` diretamente | `main.ts` | backend-core |
| D3-2 | `MemoryBucket`: TTL de chave + varredura periódica + teto de tamanho | `global-rate-limit.guard.ts:33` | backend-core |
| D3-3 | `actorOf` não aceita `x-actor-id` como identidade de ator | `global-rate-limit.guard.ts:79-83` | backend-core |
| D3-4 | `enableShutdownHooks()` + handler SIGTERM que fecha pools | `main.ts` | backend-core |
| D3-5 | `stop_grace_period` + `init: true` nos serviços do compose | 3× `docker-compose*.yml` | infra |

### Lote 4 — Outbox transacional (médio — mexe em event bus)
| ID | Ação | Arquivo | Agente |
|---|---|---|---|
| D4-1 | `RelaySqlRunner` ganhar `connect()`; claim+enqueue+mark dentro de `BEGIN/COMMIT` | `common/outbox/outbox-relay.ts:24-29,93-112` | backend-events |
| D4-2 | Espelhar em `workers/src/queues/outbox.relay.ts:67-97` | `workers` | backend-events |
| D4-3 | Selecionar `correlationId` no `buildClaimBatchSql` (hoje a propagação é código morto) | `outbox-relay.ts:58-60` | backend-events |
| D4-4 | Índice `(published, "occurredAt")` nos 7 `outbox_events` | 7× `0001_baseline` | dados |

### Lote 5 — RBAC real (⚠️ **REQUER DECISÃO DE ARQUITETURA**)
| ID | Ação | Arquivo | Agente |
|---|---|---|---|
| D5-1 | **Decisão de modelo de roles** (bloqueia D5-2..D5-5) | — | orquestrador+usuário |
| D5-2 | `AdminStubGuard` → guard que valida `req.user.roles` do JWT | 6× `admin.guard.ts` | backend-auth |
| D5-3 | Aplicar `@Roles(...)` nas ~70 rotas de escrita listadas na matriz | 12 controllers | backend-auth |
| D5-4 | `x-identity-id` → `req.user.sub` | `customers.controller.ts:31-36` | backend-auth |
| D5-5 | `x-org-id` não vem do browser (BFF repassa em 5 rotas) | `admin/app/api/finance/**` | frontend-bff |
| D5-6 | BFF fail-closed em prod: 43 de 45 rotas admin | `apps/admin/app/api/**` | frontend-bff |

### Lote 6 — Pipeline de eventos (⚠️ **REQUER DECISÃO — liga dinheiro real**)
| ID | Ação | Arquivo | Agente |
|---|---|---|---|
| D6-1 | **Decisão de escopo** (bloqueia D6-2..D6-6) | — | orquestrador+usuário |
| D6-2 | `bullmq` como dependência real de `apps/api` (remover fallback silencioso) | `apps/api/package.json` + 4 factories | backend-events |
| D6-3 | Wire `handleBillingApplyJob` no lugar do no-op | `workers/main.ts:187-206` | backend-events |
| D6-4 | Conectar `PaymentApplyPort` a `BillingService.confirmPayment` | `webhook.module.ts`, `billing.module.ts` | backend-billing |
| D6-5 | Corrigir nome da fila de comms + payload compatível | `workers/main.ts:81,170` vs `comm.queues.ts:9` | backend-events |
| D6-6 | Relay do worker com pools reais por domínio | `workers/main.ts:400-413` | backend-events |

### Lote 7 — Performance (baixo risco, ganho mensurável)
| ID | Ação | Arquivo | Agente |
|---|---|---|---|
| D7-1 | `listPlans`: 1 query com `WHERE planId = ANY($1)` em vez de N | `plans.service.ts:43-52,114` | backend-produtos |
| D7-2 | `resolveCustomerNames`: `p-limit(8)` + `AbortSignal.timeout(3s)` | `admin/lib/billing/map.ts:160-177` | frontend-bff |
| D7-3 | `support.service`: TTL + teto nos Maps + rate limit na rota pública | `support.service.ts:99-103` | backend-support |
| D7-4 | `idx_entitlements_lookup` incluir `ownerType` | `prisma/access/migrations/0003` | dados |
| D7-5 | Índice em `audit_events(id)` para o seek do cursor | `prisma/audit` | dados |
| D7-6 | Sweep `licensing.evaluate`: `UPDATE ... LIMIT 500` em vez de full-table | `access-evaluator.service.ts:102-137` | backend-access |

### Lote 8 — Infra e dependências
| ID | Ação | Arquivo | Agente |
|---|---|---|---|
| D8-1 | Unificar `name` do compose (fixar `COMPOSE_PROJECT_NAME`) | 3× compose | infra |
| D8-2 | Redis: `--maxmemory 192mb --maxmemory-policy allkeys-lru` | `docker-compose.yml:61` | infra |
| D8-3 | Alinhar `CONNECTION LIMIT` dos roles com `connection_limit`×2 | `init-consolidated.sql:58-91` | infra |
| D8-4 | `env_file required: true` + sem fallbacks `dev_*_pw` em prod | `docker-compose.prod.yml` | infra |
| D8-5 | `vitest >= 4.1.11` (fecha 2 CRITICAL de tinypool) | `package.json` raiz | infra |
| D8-6 | Corrigir `.trivyignore` (justificativa AVIF errada) + remover expiração 2027-01-15 | `.trivyignore` | infra |
| D8-7 | `apps/api` ganha script `typecheck` | `apps/api/package.json` | infra |
| D8-8 | CI roda `pnpm test:e2e` (destrava 7 specs mortas) | `.github/workflows/ci.yml:77` | infra |

---

## 4. Onda 3 — Conferência ponto a ponto (protocolo)

Para **cada** item da Onda 2, o conferente produz:

```
ID:            D1-1
CLAIM:         markReceived duplica Transaction sob concorrência
ALTERADO:      apps/api/src/modules/finance/finance.service.ts:252
ANTES:         UPDATE receivables SET status='RECEBIDO' ... WHERE id=$1 AND "orgId"=$2
DEPOIS:        UPDATE receivables SET status='RECEBIDO' ... WHERE id=$1 AND "orgId"=$2 AND status <> 'RECEBIDO'
VEREDITO:      CONFIRMADO | PARCIAL | REFUTADO
PROVA:         <trecho literal do arquivo, pós-alteração>
TESTE:         <teste novo/aditado> | <teste existente que passa> | SÓ-REVIEW
REGRESSÃO:     typecheck 7/7 | jest 49/485 | e2e 7 specs
```

**Regras de reprovação automática:**
- `VEREDITO: REFUTADO` → o item não corrigiu o que dizia corrigir → volta à Onda 2.
- Sem `PROVA` com trecho literal → item não conta.
- `jest` < 485 ou `typecheck` < 7/7 → **toda a Onda 2 volta**, não só o item.

## 5. Onda 4 — Prova de conformidade

| Checagem | Comando | Baseline |
|---|---|---|
| Lint não regrediu | `pnpm turbo run lint` | 8 workspaces |
| Typecheck não regrediu | `pnpm turbo run typecheck` | 7/7 |
| Lógica não regrediu | `pnpm --filter @aurum-bit/api test` | 49 suites / 485 testes |
| Workers não regrediu | `pnpm --filter @aurum-bit/workers test` | 1 suite |
| Build | `pnpm turbo run build` | api+workers (tsc) |
| **E2E (o gate que não existe hoje)** | `pnpm test:e2e` | 7 specs — **D8-8 habilita no CI** |
| Prisma | `bash deploy/scripts/prisma-validate.sh` | ⚠️ precisa rede |
| Migrações | `bash deploy/scripts/migrate-diff-check.sh` | ⚠️ sem `psql` → exit 0 |
| Segredos | `gitleaks detect --config .gitleaks.toml` | ⚠️ binário ausente |
| Imagem | `trivy fs --severity HIGH,CRITICAL` | ⚠️ binário ausente |

**Gaps que a conferência NÃO fecha** (declarar, não esconder): `apps/admin`, `apps/portal`, `apps/workers/src/main.ts` e as 8 `libs/*` **não têm teste nenhum**. Qualquer item de frontend/BFF é verificado por **review + typecheck + build**, não por prova automática.

---

## 6. Decisões que preciso de você antes de executar

**D-A — Modelo de RBAC (bloqueia Lote 5, ~70 rotas):**
- (a) Roles no JWT + `@Roles()` nos controllers — usa `roles.guard.ts` que já existe, hoje morto. Exige popular `roles` no token no login.
- (b) Manter header, mas exigir `x-service-token` (segredo) em vez de `x-role` — mais simples, mas não distingue manager de admin.
- (c) Híbrido: JWT `roles` + `x-service-token` para rotas internas.

**D-B — Escopo do pipeline de eventos (bloqueia Lote 6, liga dinheiro real):**
- (a) Ligar tudo agora (bullmq + wiring + PaymentApplyPort) — o pipeline funciona de fato, mas um pagamento real passa a ser aplicado automaticamente.
- (b) Ligar só o que não move dinheiro (relay + outbox transacional + comms), deixar billing manual.
- (c) Preparar (deps + wiring + feature flag `BILLING_PIPELINE_ENABLED=0`) e não ativar.

**D-C — Confiança no Ativador do Billing:**
Com D-B(a), o relay passa a publicar eventos que hoje ficam parados. Antes de ativar, é preciso um **ensaio com Asaas Sandbox** (que é o modo default do projeto) e verificar se `webhook_receipts` sai de `RECEIVED`/`VALIDATED`.

**Recomendação minha:** começar pelo **Lote 0** (5 itens, todos reversíveis, destravam o CI/CD) e **Lote 1** (5 itens, gain financeiro imediato), medir, e só então decidir D-A e D-B com dados na mão.

---

## 7. Ordem de execução sugerida

```
Onda 2a: Lote 0 (bloqueadores)     → Onda 3a → Onda 4 parcial
Onda 2b: Lote 1 (financeira)       → Onda 3b → Onda 4
Onda 2c: Lote 2 (auth)             → Onda 3c
        ─── DECISÃO D-A / D-B ───
Onda 2d: Lote 4 (outbox)           → Onda 3d
Onda 2e: Lote 5 (RBAC)             → Onda 3e
Onda 2f: Lote 6 (pipeline)         → Onda 3f
Onda 2g: Lotes 3, 7, 8             → Onda 3g
Onda 4:  conformidade completa + rebuild do grafo
```