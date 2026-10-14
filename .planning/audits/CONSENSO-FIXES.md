# CONSENSO — auditoria agêntica + correções atômicas — 2026-10-10

Fontes: `MAP-REPORT.md` (mapa), `FINANCE-ASAAS-REPORT.md` (financeiro/Asaas),
`E2E-REPORT.md` (validação) + verificação independente do orquestrador ao vivo.
Regra do consenso: **só vira correção o que foi confirmado por evidência**
(código + execução); claims refutados estão marcados.

## Vereditos finais por item

| # | Item | Veredito | Evidência |
|---|---|---|---|
| 1 | Webhook Asaas (token timing-safe, dedupe, out-of-order) | APROVADO c/ ressalva sanada | `webhook.service.ts:149-163`, `transitions.ts:19`; allowlist vazia agora emite warn + `ASAAS_IP_ALLOWLIST` documentada no `.env.example` |
| 2 | Idempotência/transições billing | APROVADO | `Idempotency-Key` + `ON CONFLICT` + ilegais→422; `REFUND/PAYMENT_STATUSES` agora derivados de `AGGREGATE_FLOWS` (sem drift) |
| 3 | Regra ouro financeiro (só Transaction muta saldo) | APROVADO | `finance.service.ts:31,272,410` markReceived/markPaid mesma txn |
| 4 | RBAC financeiro (`finance.read`/`manage`) | RESSALVA herdada | Guards stub por header (`x-finance-read`, `x-role`) — unificação é workstream de fase (não atômico) |
| 5 | Reconciliação + DLQ | RESSALVA parcial | Recon hourly/daily real; replay DLQ = lógico + explícito (`mode:'logical'`); workers billing apply/recon/relay ainda stubs |
| 6 | Padrões Asaas sandbox | APROVADO | base `/api/v3`, header `access_token`, eventos `PAYMENT_*`, retry só transitório |
| 7 | Claim "auth 401 no ar" | CONFIRMADO → CORRIGIDO | Faltava `@Public()` nas 8 rotas públicas (register/verify/resend/login/refresh/forgot/reset/mfa-verify); bootstrap era impossível |
| 8 | Claim "resend 401 no ar" | CONFIRMADO → CORRIGIDO | Faltava `@Public()`; agora 200 |
| 9 | Licensing órfão (19 rotas) | CORRIGIDO parcial | Devices (6) + offline (1) registrados; flow (12) fora de propósito (conflito direto c/ core) |
| 10 | Finance shadowing | DOCUMENTADO exato | Lista exata no `finance.module.ts` + docs; unificação = decisão de produto |
| 11 | Docs vs código (139/25) | CORRIGIDO | 145 definidos / 133 expostos + 28 BFF em `ARCHITECTURE.md`, `ENDPOINTS-INVENTORY.md`, `MAP-REPORT.md` |
| 12 | Admin em crash loop | CORRIGIDO (5 causas) | lock npm válido + `public/` + CMD `server.js` + estáticos + `node_modules` no runner + `HOSTNAME=0.0.0.0` (Next amarrava no IP) + healthcheck p/ `127.0.0.1` (wget não cai p/ IPv4 via `localhost`) |
| 13 | API `dist/main` | CORRIGIDO | CMD → `dist/src/main` (onde o build emite) |
| 14 | Env containers vs host | CORRIGIDO | URLs internas fixas no compose; `.env` p/ host; `DATABASE_URL` singular adicionada |
| 15 | `INTERNAL_*` ausentes → 503/DLQ | CORRIGIDO | Chaves geradas no `.env` (+ documentadas no `.env.example`) |

## Correções aplicadas (arquivos)

- `apps/api/src/modules/communications/communications.controller.ts` — `@Public()`
- `apps/api/src/modules/billing/webhook.service.ts` — warn allowlist vazia
- `apps/api/src/modules/billing/billing-transitions.ts` — STATUS derivados dos fluxos
- `apps/api/src/modules/licensing/licensing.module.ts` — devices + offline registrados
- `apps/api/src/modules/admin/dlq.controller.ts` — `mode:'logical'` explícito
- `apps/api/src/modules/finance/finance.module.ts` — sombras listadas
- `apps/admin/Dockerfile` — `public/`, CMD, estáticos, `node_modules`
- `apps/admin/package-lock.json` — lock npm genuíno (era shim pnpm)
- `apps/api/Dockerfile` — CMD `dist/src/main`
- `deploy/docker-compose.yml` — env de container fixo (+ `DATABASE_URL`)
- `.dockerignore` — `**/node_modules`, `**/dist`, `**/.next`
- `.env` / `.env.example` — JWT, DATABASE_URL, INTERNAL_*, ASAAS_IP_ALLOWLIST, escape `$$`
- `docs/ARCHITECTURE.md`, `.planning/ENDPOINTS-INVENTORY.md`, `.planning/audits/MAP-REPORT.md` — contagens e notas
- `start-backend.ps1` — painel fixo (banner + status/serviço + logs contidos) + flags `-Tunnel/-SkipSeed`
- `docs/knowledge/` NOVO — `graph.json` (37 nós, 33 arestas), `build.js`, `query.js`, `chunks.json` (103 chunks), `README.md`; scripts `knowledge:build`, `knowledge:ask` no `package.json`

## Verificação final

- Unit 377/377 + e2e 42/42 (pós-correções)
- Ao vivo: `/health/ready` 200 (postgres+redis up), resend 200, devices/offline 401-sem-auth (guardadas), admin 307 (Next ok), DLQ `mode:logical`
- RAG: `node docs/knowledge/query.js "..."` retorna trechos com fonte + vizinhança do grafo

## Pendências honestas (exigem gente, não dá p/ atomizar com segurança)

1. **ROTACIONAR `ASAAS_API_KEY`** — apareceu em chat/logs/histórico; revogar no painel Asaas e gerar nova.
2. **`ASAAS_WEBHOOK_SECRET` real** — Asaas (aba Webhooks) + `.env` + `up -d api workers`.
3. Workers billing stubs (`apply`/`recon`/`relay` log-only) + RBAC real + unificação finance + projeções duplas — workstreams de fase com decisão de produto.
4. `migrate-all.sh`: sem pastas `migrations/` (no-op); precisa de prisma (download) quando houver migrations.
