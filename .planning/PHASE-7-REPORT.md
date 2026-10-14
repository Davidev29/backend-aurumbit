# PHASE-7-REPORT.md — Produção single-VPS (execução 2026-10-14)

Padrão GSD EXECUTE PHASE 07, orquestrador + 10 frentes (T0–T8 + QA).
9 subagentes falharam por rede (`ENOTFOUND opencode.ai`); o trabalho foi
executado diretamente pelo orquestrador com o mesmo rigor (clean code,
verificação individual por entrega, validação final). 1 frente (T7) veio de
subagente. Achados corrigidos estão marcados **[CORRIGIDO]**.

## 1. Entregas por tarefa (arquivo → verificação)

| # | Entrega | Verificação (comando + resultado) |
|---|---------|-----------------------------------|
| T0 | `apps/portal/lib/upstream.ts` (fail-closed 502 UPSTREAM_MISSING em prod, mock só dev) + BFF `app/api/products/**` via `resolveUpstream` + `deploy/scripts/smoke-t0.sh` (a/b/c + teste negativo) | `smoke-t0.sh --check-only` PASS (3/3); `tsc -p apps/portal` PASS; live Docker SKIP (daemon off no Windows — roda na VPS/CI) |
| T1 | `deploy/docker-compose.prod.yml` (loopback, portal, migrate one-shot, CORS prod, mailhog `profiles:[dev]`, restart, log limits, mem_limit, tags SHA) + `tag-images.sh` | `config` PASS + **semântico** PASS: host_ip 127.0.0.1 nos 6 serviços; depends postgres→migrate→api→portal; restart/mem/logging conferidos via JSON |
| T1 **[CORRIGIDO]** | `ports:/depends_on: !reset` zerava tudo no Compose v5.4.0 (config OK mas portas=None — Caddy inalcançável) | Trocado p/ `!override` + nota no topo do arquivo; revalidado semanticamente (host_ip + depends) |
| T2 | `.env.example` template prod + `gen-prod-env.sh` + `docs/RUNBOOKS/env-prod.md` + job `secrets` gitleaks no CI | geração PASS (chmod 600, 64hex, recusa overwrite exit 1, sem segredos no stdout, ADMIN_DEV_OPEN ausente) |
| T3 | `deploy/scripts/seed-prod.sh` (admin + grant ADMIN + perfil PF + catálogo 3 produtos/4 planos/features, upserts, assert de colunas fail-closed) + `seed-all.sh` (SEED_MODE) + `verify-dbs.sh` + `migrate-diff-check.sh` | `bash -n` PASS (4/4); hash scrypt PASS; contagens âncora no script; live psql SKIP (sem PG local — roda na VPS/CI) |
| T4 | `deploy/caddy/Caddyfile` (3 hosts, www→apex, HSTS, health_uri api) + `docker-compose.caddy.yml` + `deploy/scripts/pre-dns-check.sh` (modo pin + resolve) | `bash -n` PASS; `caddy validate` SKIP (daemon off — roda na VPS/CI, comando no Caddyfile + runbook) |
| T5 | `pg-backup.sh` (dump cifrado + rclone + retenção 14d + dead-man) + `pg-restore-probe.sh` (9 DBs + counts, semanal) + `backup-check.sh` estendido (dumps=WARN) + `deploy/backup/README.md` | `bash -n` PASS (3/3); round-trip gpg/rclone SKIP (bins ausentes no Windows — roda na VPS) |
| T6 | `smoke-prod.sh` (8 checks TAP, duplicata webhook, --live c/ confirmação) + `uptime-targets.json` (3 monitores) + `webhook-replay.md` | `bash -n` PASS; `--help` PASS; JSON válido PASS; live SKIP (sem prod) |
| T7 | `docs/RUNBOOKS/deploy.md` (10 gates) + `harden-vps.sh` + `disk-check.sh` | `--dry-run` PASS; `disk-check` PASS (exit 2 WARN correto em disco 81%); apply recusado sem ALLOW_SSH_KEY PASS |
| T8 | `clone-ready-timer.sh` + jobs CI `prod-config` (ampliado p/ 15 scripts) + `clone-ready` nightly + `clone-ready.md` | `--dry-run` 305s PASS; `bash -n` PASS |
| QA | Este report + gates §3 | ver §3 |

Residuais honestos (não-silenciosos): BFF auth/me/checkout ainda usam stub
quando `API_INTERNAL_URL` ausente fora de products — em prod o compose sempre
injeta a var (fail-closed prático); guarda global total é melhoria Fase 8.
Seed troca-senha = procedural (sem campo no schema, fora de escopo Fase 7).

## 2. Gates de reversibilidade (§6) — todos documentados, nenhum acionado

DNS (só após pre-dns PIN+RESOLVE verde, TTL 300, fora de horário); Asaas prod
(valor mínimo + estorno); LICENSE_KEY_ENC_KEY off-VPS antes da 1ª licença;
purge PROIBIDO sem T5 recorrente. Reversível: tag anterior, reload Caddy,
up -d, rollback DNS (TTL 300).

## 3. Gates de qualidade (§7)

- `bash -n`: 15/15 scripts PASS. `compose config` PASS + semântico PASS.
- `tsc portal` PASS. `unit api` PASS: 44 suites, 429/429 (baseline 377, sem regressão).
- `prisma validate` 9/9: roda no CI `prod-config` (SKIP local sem pnpm install novo — sem threshold novo).
- e2e 42: preservados (CI `e2e-ephemeral`); smoke local/prod na VPS.
- Adiamento formal: consumidor `/metrics` → Fase 10 (smoke só checa 200).

## 4. Critério de pronto (§9) — checklist

- [ ] Domínios HTTPS verdes (VPS: Gate 6 runbook deploy)
- [x] Vitrine anti-mock (código pronto + teste negativo; live na VPS)
- [ ] Compra real estornada + duplicata → DUPLICATE (VPS, --live)
- [ ] Login admin + senha trocada (pós seed-prod)
- [ ] Backup do dia local+remoto + probe semanal + dead-man testado (VPS cron)
- [ ] Uptime externos UP (importar uptime-targets.json)
- [ ] Reboot validado + clone→ready <10min real (VPS/Linux)
- [x] Runbook executável por terceiro (10 gates copiáveis)

## 5. Incidente de processo (transparência)

`.env` local contém chaves (sandbox `hmlg` + Resend) e vazou no output de
`compose config` durante a auditoria. `.env` está no `.gitignore` e não há
repo git — sem risco de commit — mas recomenda-se **rodar `config` com
`--quiet` fora de sessão auditada e rotacionar as chaves se compartilhadas**.
