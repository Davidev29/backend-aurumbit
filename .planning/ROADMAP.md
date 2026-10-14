# Aurum Bit — ROADMAP.md (rev. 2026-10-14)

## Fase 1 — Fundação (planejada, sem código até revisão)
Ver `.planning/PHASE-1-PLAN.md`. Saída: clone→Compose→migrate→seed→ready 200 <10min.

## Fase 2 — Identidade e acesso
Auth, customers, products, access base, admin shell. Guards Jwt→Session→Mfa→Verified→Roles→CustomerScope.

## Fase 3 — Licenciamento
Licenças + devices + offline 7d (semântica PROJECT §1) + chaves hash/masked/reveal (PROJECT §2).

## Fase 4 — Faturamento e integrações
Asaas Sandbox, webhook idempotente + reconciliação (PROJECT §5), Outbox/BullMQ, Resend escopo real (PROJECT §6).

## Fase 5 — Financeiro e relatórios
Previsto/pendente/realizado, projeções, `finance.read` explícito escopado (PROJECT §3).

## Fase 6 — Robustez e escala
Carga, backup, DLQ, retenção IP/device/geo (PROJECT §4), extração serviços se gatilho.

## Fase 7 — Produção single-VPS (site + stack no ar)
Ver `.planning/PHASE-7-PLAN.md`. Portal no compose (override prod), Caddy + TLS,
`.env` prod real, migrate + seed real, backup com restore executável, smoke pós-deploy.
Fecha a pendência Fase-1 (runtime <10min) em ambiente real.

## Fase 8 — Modelo comercial: licença × assinatura + web limitada
`ONE_TIME` (desktop perpétuo) vs `MONTH/YEAR` (SaaS web) com validação por
`billingInterval` em Subscription/Invoice; `kind=lifetime` em licensing;
capabilities `WEB_*` vs `DESKTOP_*` (channel em Feature/Entitlement/offline-JWT);
gating server-side + matriz replicada na web; checkout pós-pagamento real
(Asaas→licença, sem tela `done` sem cobrança).

## Fase 9 — Bancos por produto (`app_<slug>`)
`APP-DATABASE-CONTRACT.md` (esqueleto, refs opacas, outbox obrigatória);
gerador de schema + `DATABASE_URL_APP_<SLUG>`; listas hardcoded (`migrate-all`,
`init-dbs`, `backup-check`, relay) viram registro dinâmico; piloto `app_<slug>`
de 1 produto; correção dos bancos existentes pelo checklist; backup `9+N`.

## Fase 10 — Sync bidirecional offline-first
`SYNC-PROTOCOL.md` (pull cursorado + push idempotente, tombstones, `rev`,
`originDevice`, LWW determinístico, financeiro append-only); `SyncCursor` por
consumer antes de ligar purge automático; piloto 1 entidade 1 produto com UI de
conflitos; motor de sync desktop compartilhado; métricas `sync_lag_*` e alarmes.
Ordem proposital: por último — depende dos contratos das Fases 8–9.
