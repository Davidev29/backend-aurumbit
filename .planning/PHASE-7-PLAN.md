# PHASE-7-PLAN.md — Produção single-VPS (rev. 2026-10-14b, incorpora revisão externa)

## 1. Objetivo
Site + stack completa no ar numa única VPS em produção real (nada de mock,
nada de sandbox): `https://aurumbit.com` (portal), `admin.` + `api.` (subdomínios),
9 bancos migrados, backup com restore executável **e cópia fora da VPS**,
monitoramento com canal real, sobrevivência a reboot.

## 2. Contexto travado (não renegociar nesta fase)
- Monólito + 9 DBs + outbox + sem FK cross-DB (ADR-001, PROJECT visão).
- Offline/graça/chaves/finance Guards/billing idempotente (PROJECT §§1-6, ADRs 002-005).
- Fases 1–6 entregues: builds PASS, unit 377, e2e 42 (STATE.md).

## 3. Fora de escopo (vai para Fases 8–10, ou adiado explicitamente)
Sync bidirecional, capabilities web-vs-desktop, `ONE_TIME`/perpétuo, `app_<slug>`,
mudanças de schema de produto, novos templates de e-mail.
**Consumidor do `/metrics` (Prometheus/Grafana) adiado explicitamente**: o smoke
valida que o endpoint responde, mas ninguém o lê nesta fase — coleta e dashboards
ficam para a Fase 10 (junto das métricas `sync_lag_*`). Não é pendência silenciosa:
é adiamento formal registrado aqui.

## 4. Tracer primeiro (fatia end-to-end verificada antes da expansão)
**T0 — Portal no compose + smoke local prod-like.** Adicionar serviço `portal`
ao compose (build `apps/portal/Dockerfile`, `API_INTERNAL_URL=http://api:3000`,
`NEXT_PUBLIC_SITE_URL` real), subir `postgres→migrate→api→portal` e validar:
(a) `GET / → 200` com vitrine vinda da API (não mock);
(b) **teste negativo anti-mock**: derrubar o container `api` e verificar que a home
**degrada visivelmente** (erro 502/estado de erro, nunca conteúdo mock silencioso);
(c) `GET /api/products → 200`.
Só avança para TLS/DNS quando o tracer estiver verde — todo o resto é expansão.

## 5. Tarefas de expansão
| # | Tarefa | Verificação |
|---|--------|-------------|
| T1 | `deploy/docker-compose.prod.yml` (override): portas só `127.0.0.1`, bloco `portal`, `CORS_ORIGIN` prod, `NEXT_PUBLIC_API_URL=https://api.aurumbit.com` no admin, mailhog fora (`profiles: [dev]`). **Auto-cura de reboot**: confirmar `restart: unless-stopped` em todos os serviços (já existe no base — verificação, não novidade) + cadeia `depends_on: condition: service_healthy` (`postgres→migrate→api→portal`). **Disco**: `max-size`/`max-file` no log driver do Docker + cron de `df` com alerta. **Recursos**: `mem_limit` por serviço + swap configurado; VPS dimensionada (piso 4 GB, confortável 8 GB). **Rollback por tags**: imagens tagueadas por git SHA, retenção das N anteriores, compose referenciando tag fixa (nunca `:latest` flutuante) | `config` OK; portas só em loopback; `docker update --restart` auditado; reboot de teste volta sozinho (validar em staging ou janela de manutenção); `docker system df` dentro do teto; `docker images` mostra SHAs retidos |
| T2 | `.env` prod real: senhas PG, `INTERNAL_*` + `LICENSE_KEY_ENC_KEY` gerados, Asaas **prod**, Resend prod, `ADMIN_DEV_OPEN` ausente; `chmod 600`, nunca commitado. **A chave de licença entra no backup (T5) no mesmo ato da geração** — perdê-la é irreversível (licenças emitidas ficam indecifráveis), ver §6 | boot sem fail-fast; `reveal` deixa de responder 409; `gitleaks` limpo; cópia cifrada da chave fora da VPS |
| T3 | Migrate + seed real: `migrate-all.sh` nas 9 DBs; `seed.ts` deixa de ser stub (admin demo com troca de senha obrigatória + catálogo mínimo) | `backup-check.sh` → `done (ok: pg up + 9 DBs)`; `SELECT count` nas 9 |
| T4 | Caddy + TLS + corte de DNS: `Caddyfile` (3 hosts → 127.0.0.1:3002/3001/3000), **redirect `www` → apex**, HTTP→HTTPS. **Pré-requisitos do corte**: (a) TTL 300s com 24–48h de antecedência (rollback rápido); (b) SPF/DKIM/DMARC da Resend na mesma janela (sem eles, transacional não sai). **Validar antes do corte**: stack na própria VPS testada com `curl --resolve aurumbit.com:443:<IP_VPS>` — DNS vira o último passo, não o primeiro | `curl -sI https://aurumbit.com/` → 200; certificado válido; HSTS; `curl --resolve` verde **antes** da troca de DNS; registros TXT de e-mail consultáveis |
| T5 | Backup = DR, não dump local: `pg_dumpall` diário **cifrado** (contém PII) + **cópia off-VPS** (`rclone` → S3/B2) + retenção 14d; inclui `.env` e `LICENSE_KEY_ENC_KEY` (cifrados); tamanho do dump registrado a cada execução. **Restore probe recorrente (semanal, não pontual)**: mesmo script restaura em `restore_probe_*` e checa **as 9 DBs + contagens**, não só `SELECT 1`. **Canal real de alerta**: dead-man switch (Healthchecks.io ou similar) — o cron faz ping ao final; sem ping em 24h → alerta. Fecha o TODO de `backup-check.sh` | dump do dia existe local + remoto; probe semanal restaura 9 DBs com contagens; simular falha (matar cron 1 dia) dispara o alerta do dead-man |
| T6 | Smoke pós-deploy + monitores externos: home, `#produtos` (dados da API), checkout (compra mínima + estorno), **re-entrega de webhook Asaas duplicado sem duplicar no billing** (exercita os Guards que já existem), URL de webhook confirmada no painel Asaas **prod**, login admin, `/health/live`. **Uptime externo** nos 3 hosts (UptimeRobot/Better Stack ou similar) — sem isso, falha só aparece quando o usuário liga | checklist verde; duplicata de webhook → `DUPLICATE`, sem 2ª cobrança/licença; monitores externos respondendo |
| T7 | RUNBOOK deploy: `docs/RUNBOOKS/deploy.md` — inclui **hardening da VPS** (ufw só 22/80/443, SSH só chave, `unattended-upgrades`, NTP/sync de relógio — billing e webhooks sofrem com clock skew), comandos T0–T6, rollback por tag (T1) | terceiro executa só pelo runbook, do zero ao verde |
| T8 | Pendência herdada Fase-1 (ex-PHASE-1-REPORT:26): validar runtime **clone→ready <10min** com Docker real, fim a fim | cronômetro do `git clone` ao `ready ok` < 10min, registrado no report da fase |

## 6. Gates de reversibilidade (one-way doors = checkpoint humano antes)
- **Corte de DNS**: só após T4 pré-validado (`curl --resolve` verde + TTL 300 + e-mail DNS). Confirmar fora de horário comercial.
- **Chaves Asaas prod + primeira cobrança real**: validar antes em valor mínimo com estorno.
- **Perda da `LICENSE_KEY_ENC_KEY`**: tão irreversível quanto o corte de DNS — checkpoint = confirmar cópia cifrada off-VPS (T5) **antes** de emitir a primeira licença real.
- **Purge/retention ligado em prod**: só após T5 verde recorrente (sem restore testado, sem purge automático).
- Reversível sem checkpoint: rebuild de imagem (tag anterior retida), reload Caddy, `up -d` de serviço, rollback de DNS em minutos graças ao TTL 300.

## 7. Gates de qualidade (toda tarefa)
`turbo run lint → typecheck → test (api 377+) → build → prisma validate (9) →
e2e (42) → smoke local → smoke prod`. CI existente (`.github/workflows/ci.yml`)
mais job de `config` do compose prod. Sem threshold novo; sem teste supérfluo.

## 8. Riscos mapeados (com endereço; residuais após as tarefas)
- `NEXT_PUBLIC_*` assadas no build: rebuild obrigatório a cada troca (portal roda `next start`).
- `.env.example` usa `aurum_*`, compose/init usam bare — padronizar no `.env` prod (bare).
- `seed-all.sh` stub; `migrate-new.sh` restrito aos 9 nomes; `backup-check.sh` FAIL se `COUNT!=9`.
- Portal com `API_INTERNAL_URL` ausente → mock silencioso: coberto pelo teste negativo do T0.
- Divergência `win32` vs Linux no `standalone`: build de prod no Linux (CI/VPS), nunca no Windows.
- Retention SQL com nomes de tabela errados (`retention.service.ts:51-80`): purge continua proibido em prod nesta fase.
- Disco cheio para Postgres de forma feia: coberto por log limits + `df` + tamanho de dump (T1/T5).
- Proteção do admin nesta fase = básica (rate limit no Caddy ou IP allowlist na largada); RBAC real continua pendente (ver `produtos-offline.md`).

## 9. Critério de pronto
Domínios HTTPS verdes + vitrine com dados reais + compra real estornada +
duplicata de webhook sem efeito + login admin com senha trocada + backup do dia
**local e off-VPS** + restore probe semanal agendado + dead-man + uptime externos
verdes + reboot validado + runbook executável por terceiro + clone→ready <10min.
Aí a Fase 7 fecha e a 8 pode começar.
