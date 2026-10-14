# Runbook — `.env` de produção (Fase 7 T2)

Template: `.env.example` (placeholders, sem valores reais).
Gerador: `bash deploy/scripts/gen-prod-env.sh` → cria `.env.prod.new` (`chmod 600`,
recusa sobrescrever sem `--force`, não imprime segredos).

## Gerar (na VPS, nunca no Windows)

```bash
bash deploy/scripts/gen-prod-env.sh
# completar TROCAR_* (Asaas PROD + Resend PROD) via cofre
mv .env.prod.new .env.prod && chmod 600 .env.prod
```

## Boot fail-fast

A API valida o env no boot (`apps/api/src/config/env.schema.ts`): env inválida =
boot aborta com `Env inválida (fail-fast): …`. Sem `LICENSE_KEY_ENC_KEY`, o boot
**não** trava — o `reveal` de licenças responde **409 honesto** (by design).
`reveal` sem 409 = chave configurada. `INTERNAL_*` ausentes = sync/apply internos
respondem 503 fail-closed.

## `NEXT_PUBLIC_*` assam no build

`NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SITE_URL` entram no bundle no `next build`.
Trocar valor exige **rebuild + redeploy** das imagens portal/admin (build sempre
no Linux — CI/VPS).

## Gitleaks

CI tem job `secrets` (`gitleaks/gitleaks-action@v2`, só detecção, sem segredos).
Local: `gitleaks detect --no-git -v` (se instalado) ou
`grep -ri "sk-live\|asaas.*live.*key" --exclude-dir=node_modules .` (vazio = ok).

## Cópia cifrada da chave OFF-VPS (checkpoint §6 — ANTES da 1ª licença)

Perder `LICENSE_KEY_ENC_KEY` = irreversível (licenças indecifráveis). No mesmo ato
da geração:

```bash
gpg -c .env.prod            # gera .env.prod.gpg (senha forte do cofre)
rclone copy .env.prod.gpg <remote-off-vps>:aurum-bit/env-backups/
```

Só emitir a primeira licença real com: backup cifrado (T5) contendo a chave +
cópia cifrada off-VPS confirmada. `ADMIN_DEV_OPEN` nunca existe em prod.

## Proibições

Nunca escrever segredo real em arquivo commitado; nunca commitar
`.env`/`.env.prod`/`.env.prod.new`; nunca logar segredos.
