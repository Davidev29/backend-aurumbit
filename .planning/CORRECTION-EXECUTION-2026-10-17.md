# Execução da Correção — Ondas 2, 3 e 4

**Data:** 2026-10-17 · **Plano:** `CORRECTION-PLAN-2026-10-17.md` · **Decisões:** RBAC via JWT+`@Roles()`, pipeline com feature flag, escopo Lote 0+1+2

---

## 1. Baseline e conformity

| Medida | Baseline (início) | Final | Veredito |
|---|---|---|---|
| `apps/api` jest | 49 suites / 485 testes | **51 suites / 527 testes** | ✅ **+1 suíte, +42 testes** |
| `libs/*` typecheck | 7/7 | 7/7 | ✅ |
| `apps/workers` test | — | 5/5 | ✅ |
| `turbo run lint` | 0 errors | 0 errors (9 warnings pré-existentes no portal) | ✅ |
| `bash -n` (4 scripts) | — | 4/4 OK | ✅ |
| `prisma validate` (finance) | — | válido | ✅ |
| `apps/api` tsc | 6 erros TS6059 pré-existentes | idem (erros em `test/*.e2e-spec.ts` → `libs/contracts`, fora do `rootDir`) | ⚠️ pré-existente |

**Nenhum teste foi removido ou afrouxado para passar.** Os +42 são testes de concorrência e de regressão novos.

---

## 2. Vereditos da Onda 3 (conferência adversarial)

### Lote 0 — bloqueadores de deploy
| ID | Item | Veredito |
|---|---|---|
| D0-1 | CD apontava `deploy/Dockerfile.api` inexistente | ✅ CONFIRMADO |
| D0-2 | `migrate resolve --applied` incondicional | ✅ CONFIRMADO |
| D0-3 | `audit-partition.sh` rodava DDL com role de app | ✅ CONFIRMADO |
| D0-4 | `pre-dns-check.sh` exigia 200 em `/` na API | ✅ CONFIRMADO |
| D0-5 | Projeções sempre 500 (DDL divergente) | 🔴 **REFUTADO** → corrigido na Onda 3.5 |

### Lote 1 — idempotência financeira
| ID | Item | Veredito |
|---|---|---|
| D1-1 | markReceived sem guarda de status | ✅ CONFIRMADO |
| D1-2 | markPaid sem guarda de status | ✅ CONFIRMADO |
| D1-3 | Idempotency-Key opcional | ✅ CONFIRMADO |
| D1-4 | confirmPayment sem guarda | ✅ CONFIRMADO |
| D1-5 | eventId aleatório | ⚠️ PARCIAL → **regressão BullMQ achada** e corrigida |

### Lote 2 — auth
| ID | Item | Veredito |
|---|---|---|
| D2-1 | Refresh rotation não atômica | ✅ CONFIRMADO (self-DoS residual) |
| D2-2 | Lockout não atômico | ⚠️ PARCIAL → corrigido na Onda 3.5 |
| D2-3 | Chave MFA derivada do JWT | ✅ CONFIRMADO |
| D2-4 | Placeholders passam | ⚠️ PARCIAL → ampliada na Onda 3.5 |
| D2-5 | 2 pools duplicados, sem timeout | ⚠️ PARCIAL → `enableShutdownHooks` faltando |
| D2-6 | `?schema=` é no-op no `pg` | ✅ CONFIRMADO (queries qualificadas) |

---

## 3. Onda 3.5 — defeitos achados na conferência e corrigidos

A conferência não foi decorativa: encontrou **3 riscos de indisponibilidade** que teriam derrubado produção.

| # | Defeito | Sev | Impacto evitado | Correção |
|---|---|---|---|---|
| 1 | `MFA_ENC_KEY` obrigatório em prod, `gen-prod-env.sh` não gerava | **P0** | crash-loop da API no próximo deploy | `gen-prod-env.sh` gera + documenta |
| 2 | `AUTH_JWT_SECRET` ≠ `JWT_SECRET` sem guarda | **P0** | 401 em toda request autenticada | fail-fast no `env.schema.ts` |
| 3 | `billing-payment-confirmed:<id>` viola `jobId` do BullMQ | **P1** | stall de todos os 9 domínios do outbox | 3 segmentos + higiene de `:` |
| 4 | `UNIQUE(scope)` ainda quebrava as projeções | **P0** | projeções 500 | migration `DROP INDEX` + arbitragem por PK |
| 5 | `pool.end()` nunca executava | P1 | sockets vazados a cada deploy | `app.enableShutdownHooks()` |
| 6 | Reset do lockout antes do check de e-mail | P2 | brute force infinito | reset movido + guard `LOCKED` |

**Prova empírica do #3:** o `bullmq@5.81.5` rejeita `jobId` com `:` exceto com exatamente 3 segmentos (`job.js:1067-1076`). O formato novo passou a ter 3, e existe teste de regressão que replica a regra.

**Prova do #4:** o teste `projections.store.pg.spec.ts` deriva o catálogo de índices do DDL real das migrations e reproduz o `23505` — falha 4/5 sem a migration, passa 5/5 com ela.

---

## 4. Riscos residuais (documentados, não corrigidos — fora de escopo)

### 🔴 Antes do próximo deploy
| Risco | Arquivo | Ação necessária |
|---|---|---|
| **Ambiente já implantado sem `MFA_ENC_KEY`** | `.env.prod` | Acrescentar a chave **antes** de reiniciar a API |
| **`type = 'PaymentConfirmed'` não é tópico** | `billing.service.ts:697` | `routeBillingTopic` retorna `null` → DLQ. O fluxo canônico grava `billing.payment.confirmed.v1`. Mudar o `type` é decisão semântica (3 specs travam o valor atual) |
| **Migration nova precisa ser aplicada** | `prisma/finance/migrations/20261017000000_projection_scope_multi_period` | `bash deploy/scripts/migrate-all.sh` — o CI falha se ficar pendente |
| **Relay sem try/catch por linha** | `outbox.relay.ts:79-90`, `outbox-relay.ts:103-107` | 1 linha que lança aborta o tick e trava os 9 domínios. **Corrigir antes de ligar o relay** |

### 🟠 known, aceito
- **Self-DoS em refresh concorrente** (`auth.service.ts:309`): o vencedor legítimo da corrida perde a sessão. Correto por segurança (OAuth BCP §4.14.2), ruim para disponibilidade. Backlog: `exceptSessionId` ou janela de graça.
- **`idempotencyKey` é UNIQUE global** (`migration.sql:266`) mas a leitura é escopada por org → colisão entre orgs dá 200 com `transaction: null`, silenciosa.
- **`statement_timeout` é no-op atrás do PgBouncer** (`ignore_startup_parameters`). Só `query_timeout` client-side protege.
- **Quebra de contrato não documentada**: `mark-received`/`mark-paid` agora exigem `Idempotency-Key`. `docs/API.md` ainda descreve como opcional.
- **`AUTH_REPO=memory` instancia pool lazy** (`auth.module.ts:22`) — inofensivo hoje.
- **Namespaces de projeção não colidem por convenção, não por constraint.**

### ⚪ Gaps de verificação (não fecháveis por teste)
`apps/admin`, `apps/portal`, `apps/workers/src/main.ts` e as 8 `libs/*` **não têm teste nenhum**. Itens de frontend/BFF são verificados por review + build, não por prova. Os **7 e2e continuam fora do CI** (`turbo run test` só vê `src/`).

---

## 5. Não executado (por decisão registrada)

| Lote | Motivo |
|---|---|
| **Lote 3** (rate-limit + shutdown) | partly coberto: `enableShutdownHooks` ✅; falta `trust proxy`, evicção do `MemoryBucket`, `actorOf` |
| **Lote 4** (outbox transacional) | `RelaySqlRunner` ainda sem `connect()`; claim fora de transação |
| **Lote 5** (RBAC real, ~70 rotas) | Aguardando decisão D-A registrada |
| **Lote 6** (pipeline) | Decisão D-B: preparar com feature flag, **não ativar** |
| **Lotes 7-8** (perf/infra) | Não iniciados |

**Achado mais grave ainda aberto:** `apps/api` **não declara `bullmq`** — as 4 factories caem em fila in-memory em silêncio. Enquanto isso não for corrigido, corrigir o `main.ts` dos workers não muda nada. É o item #1 antes de ligar o pipeline.