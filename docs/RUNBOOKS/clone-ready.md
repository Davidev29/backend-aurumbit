# Runbook — clone→ready <10min (T8 Fase 7)

Fecha a pendência `PHASE-1-REPORT:26`: validar runtime **clone fresco → `/health/ready` 200 em <10min**, com Docker real, fim a fim.

Script: `deploy/scripts/clone-ready-timer.sh`. Imprime cronômetro por etapa (`clone/build/migrate/seed/ready`) e veredito `<10min PASS` / `>=10min FAIL` (exit 0/1).

## 1. Pré-requisitos

- **Linux** (host ou VPS) com Docker Engine + plugin compose + `git`, `curl`, `bash`.
- Portas livres: `3000` (api), `5432`, `6379`, `8025`, `3001`.
- ⚠️ **Windows (win32): não meça aqui.** O build de prod roda no Linux (CI/VPS), nunca no Windows (PLAN §8 — divergência `standalone`). No Windows use só `--help` e `--local --dry-run` (simulação, sem Docker).

## 2. Medição canônica (clone fresco real)

```bash
git clone --depth 1 <repo-url> /tmp/clone-ready && cd /tmp/clone-ready
bash deploy/scripts/clone-ready-timer.sh --local
# ou, sem clonar antes (o script clona sozinho):
bash deploy/scripts/clone-ready-timer.sh --repo <repo-url>
```

O que ele faz, em ordem: `compose up -d --build` → `migrate-all.sh` (9 DBs) → `seed-all.sh` → poll `GET /health/live` + `/health/ready` até 200 com `"status":"ok"` (deadline = orçamento total, default 600s) → veredito. Sem `--keep`, o `trap` derruba o compose ao sair — **nenhum container órfão**.

Flags úteis: `--branch <n>`, `--dir <path>`, `--timeout <s>`, `--keep` (debug; derrube depois com `docker compose -f deploy/docker-compose.yml down -v`).

## 3. CI

- Job `prod-config` (todo PR/push, **sem daemon**): `compose config` (prod se `docker-compose.prod.yml` existir — T1 — senão base + WARN), `prisma validate` nos 9 schemas, `bash -n` nos scripts. Sem segredos, sem push, sem deploy.
- Job `clone-ready` (**só nightly `0 4 * * *` / manual**): roda o timer com `--local` (o checkout já é clone fresco). Nunca em PR/push — exige Docker real e ~10min.

## 4. Resultado (registrar no report da fase)

| Data | Host (OS/docker) | clone | build | migrate | seed | ready | total | Veredito |
|---|---|---|---|---|---|---|---|---|
| _a preencher na VPS/Linux_ | | | | | | | | |

- Simulação local (win32, sem Docker): `305s (05:05) → <10min PASS` (`--local --dry-run`, 2026-10-14, só valida o cronômetro — **não** conta como medição real).
- Medição real: executar §2 numa VPS/Linux com Docker e preencher a tabela acima; colar o bloco `[timer]` no report da fase.

## 5. Falhas típicas

| Sintoma | Ação |
|---|---|
| `FAIL em 'ready'` + logs do api | `docker compose logs api --tail=200`; checar `.env` (foi criado de `.env.example`?) e `migrate-all.sh` nas 9 DBs |
| `FAIL em 'clone'` sem `--repo` | fora de git repo: passe `--repo <url>` ou use `--local` dentro do repo |
| Portas ocupadas | `lsof -i :3000` / pare a stack anterior (`down -v`) antes de medir |
| `>=10min FAIL` legítimo | hardware fraco ou primeiro build sem cache; registrar número real no report — o gate é <10min |
