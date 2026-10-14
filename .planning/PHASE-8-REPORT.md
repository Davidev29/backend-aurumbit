# PHASE-8-REPORT.md — Modelo comercial licença × assinatura (2026-10-14)

Plano em `.planning/PHASE-8-PLAN.md`. Execução direta (subagentes sem rede).

## 1. Entregas (tarefa → verificação)

| # | Entrega | Verificação |
|---|---------|-------------|
| T0 | Tracer ONE_TIME (specs encadeadas: checkout→PaymentConfirmed→lifetime→LIFETIME/DENY→duplicata) | specs novas cobrem cada elo; worker spec prova issued→duplicate |
| T1 | `billingInterval` em Subscription/Invoice (coluna + `assertBillingInterval` + DTO + `0002` delta) | unit: inválido → 400 sem query; válido persiste (params); `prisma validate` 9/9 |
| T2 | `kind=lifetime` (LicenseKind, `calcExpiry` null, renew lifetime → 409, upgrade ok; sem migration) | unit lifetime + effectiveStatus + kindForBillingInterval; spec legada ajustada (`!`) |
| T3 | Channel (Feature/Entitlement `BOTH`, check filtra, offline-JWT `ch` nos 2 formatos, sync propaga, `0002` deltas) | unit: BOTH/canal/mismatch/adulteração; token antigo = BOTH |
| T4 | Gating server-side (DTO channel, chave de cache com canal, invalidação ×4) + `portal/lib/capabilities.ts` + badges | unit cache/invalidação; `tsc` portal PASS; UI só reflete a API |
| T5 | Checkout real (PG `createCheckoutOrder`/`getCheckoutOrder`, `issueFromPayment` claim-first, 2 endpoints internos `x-internal-key`, worker `licensing.issue`, BFF sem stub `done`, portal PENDING+polling) | unit api + worker 5/5; `nest build` PASS |
| T6 | Catálogo: `AURUM_BASE_ONETIME` + `WEB_ACCESS`/`DESKTOP_APP` (seed-prod + mocks) | `bash -n` seed; mocks tipados |
| T7 | Carry-over Fase 7: 12/12 rotas BFF com `resolveUpstream` (logout só limpa cookie — sem stub) | `smoke-t0 --check-only` PASS; grep sem `if (API_INTERNAL_URL)` desprotegido |
| T8 | `commercial.md`, inventory, migrations `0001` (9 domínios) + `0002` (4), este report | `migrate diff` baseline gerado; deltas aditivos |

## 2. Números

- Unit API: **47 suites, 464/464 PASS** (baseline 429 → +35, zero regressão).
- Worker: 5/5 PASS (node:test). `nest build` PASS. `tsc` portal PASS.
- `tsc -p apps/api` limpo em `src` (5 erros pré-existentes só em `test/`+`libs/` rootDir — não tocados).
- e2e 42: preservados (CI `e2e-ephemeral`, exige DB).

## 3. Achados corrigidos nesta fase

1. **Sem `migrations/` em nenhum domínio** (`migrate deploy` falhava) → `0001_baseline` from-empty ×9 + lockfiles. Débito Fase 1–7 fechado.
2. **`SELECT ... features FROM licenses`** (offline-token.service) sem a coluna no schema → na verdade a coluna existia; meu delta a duplicaria → `0002` licensing virou no-op documentado.
3. **Cascata só mira origin LICENSE**: contract-driven, fora do fluxo checkout — registrado, sem mudança (cancelamento de assinatura = próximo passo, não desta fase).

## 4. Critério de pronto (ROADMAP Fase 8)

- [x] `ONE_TIME` vs `MONTH/YEAR` validado em Subscription/Invoice
- [x] `kind=lifetime` vitalício (sem expiração, sem renew)
- [x] Capabilities `WEB_*`/`DESKTOP_*` (channel nos 3 níveis + offline)
- [x] Gating server-side + matriz replicada (sem autorizar sozinha)
- [x] Checkout pós-pagamento real, sem `done` sem cobrança, duplicata sem 2ª licença
- [ ] Vivos na VPS: plano ONE_TIME ativo + compra mínima + estorno (operacional, com runbook `commercial.md`)

Fase 8 de código fecha aqui; falta só a cerimônia operacional na VPS.
