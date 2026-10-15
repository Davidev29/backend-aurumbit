# Runbook — Deploy produção single-VPS (Fase 7, T7)

Do zero ao verde por um terceiro, só com este doc. Fonte normativa:
`.planning/PHASE-7-PLAN.md` §§4–6 (T0–T6). Sem segredos aqui — nunca
commite IPs, chaves ou senhas; `.env` prod tem `chmod 600` e fica só na VPS
(+ cópia cifrada off-VPS, §6).

Convenção: `VPS_IP` = IP da VPS, trabalho como `root` ou usuário com sudo,
repo em `/srv/aurum`. Todo passo termina num **gate com assert copiável**:
se o assert falha, PARE e diagnostique antes de avançar.

> Nomes de scripts seguem T1/T2/T5/T6. Cada passo começa com `test -f`;
> se um script ainda não existir (workstream paralelo), o gate falha
> alto em vez de executar meia etapa.

## 1. Pré-requisitos — 24–48h ANTES (janela que não dá p/ apressar)

VPS: **Ubuntu 24.04**, piso **4 GB RAM** / confortável **8 GB**.
DNS: baixar TTL para **300s** nos 3 hosts (`aurumbit.com`, `admin.`,
`api.`) com 24–48h de antecedência (rollback rápido, §8).
E-mail transacional (Resend) na mesma janela — sem SPF/DKIM/DMARC,
nada sai (T4):

```bash
# Gate 1 — TTL 300 visível (execute da sua máquina):
dig +short aurumbit.com | head -3
dig TXT aurumbit.com +short      # espera: v=spf1 ... resend
dig TXT resend._domainkey.aurumbit.com +short
dig TXT _dmarc.aurumbit.com +short
```

## 2. Primeiro acesso + hardening

```bash
ssh root@VPS_IP
test -f deploy/scripts/harden-vps.sh || { echo "FAIL: harden-vps.sh ausente"; exit 1; }
bash deploy/scripts/harden-vps.sh --dry-run   # lê, confere, só depois aplica
```

O dry-run só imprime. Para aplicar, o script exige prova de acesso por
chave (`ALLOW_SSH_KEY` = fingerprint da sua chave) — sem isso ele aborta
de propósito (travar-se fora do SSH é irreversível sem console):

```bash
ssh-keygen -lf ~/.ssh/id_ed25519.pub   # na SUA máquina → copie o fingerprint
ALLOW_SSH_KEY="SHA256:..." bash deploy/scripts/harden-vps.sh --apply
```

O que o apply faz (idempotente — rodar 2x não duplica nada):
ufw só **22/80/443**, sshd só chave (backup em
`/etc/ssh/sshd_config.bak`), `unattended-upgrades`, chrony + NTP,
`vm.swappiness=10`, checagem de disco. fail2ban é opcional
(`WITH_FAIL2BAN=1`).

```bash
# Gate 2 — hardening verde:
ufw status verbose            # só 22/80/443 ALLOW, resto deny
grep -qx "PasswordAuthentication no" /etc/ssh/sshd_config && echo SSH-OK
timedatectl | grep -i "synchronized: yes"   # NTP obrigatório — ver §9
```

> SSH numa sessão separada aberta antes do apply. Se algo falhar,
> restaure com `cp /etc/ssh/sshd_config.bak /etc/ssh/sshd_config &&
> systemctl reload sshd`.

## 3. Docker + swap

```bash
# Docker oficial (Ubuntu 24.04):
apt-get update && apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Swap (4 GB piso / 8 GB confortável — sem swap o OOM mata o Postgres):
fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
```

> Aviso: `fallocate` falha em alguns filesystems (ex. XFS com
> reflink/ZFS) — o `|| dd` acima é o fallback. `swapon` em VPS com
> OpenVZ/LXC pode ser bloqueado pelo host: se `swapon` falhar, suba o
> plano da VPS em vez de seguir sem swap.

```bash
# Gate 3:
docker --version && docker compose version
free -h | grep -i swap && swapon --show
```

## 4. Clone → .env prod → build → migrate → seed → up

```bash
git clone <URL-DO-REPO> /srv/aurum && cd /srv/aurum
test -f deploy/scripts/gen-prod-env.sh || { echo "FAIL: gen-prod-env.sh ausente (T2)"; exit 1; }
bash deploy/scripts/gen-prod-env.sh   # gera senhas PG/roles, INTERNAL_*, mestra de licença, Asaas/Resend prod
chmod 600 .env
```

Confira manualmente no `.env`: `ADMIN_DEV_OPEN` **ausente**,
`CORS_ORIGIN` prod, `NEXT_PUBLIC_API_URL=https://api.aurumbit.com`,
Asaas **prod** (nunca sandbox aqui). **Checkpoint one-way door
(§6 do PLAN): copie `.env` + o arquivo da mestra de licença cifrados para fora
da VPS ANTES da primeira licença real** — perdê-la é irreversível
(licenças emitidas ficam indecifráveis).

```bash
# Gate 4 — boot sem fail-fast + segredos fora do git:
grep -q ADMIN_DEV_OPEN .env && { echo "FAIL: ADMIN_DEV_OPEN presente"; exit 1; } || echo ENV-OK
gitleaks detect --source . 2>/dev/null || git status --short | grep -q "^\?\? .env" && { echo "FAIL: .env untracked/commitável"; exit 1; } || echo GIT-OK
```

Na ordem (nunca pule migrate/seed — o boot falha de propósito sem DB):

```bash
test -f deploy/scripts/tag-images.sh || { echo "FAIL: tag-images.sh ausente (T1)"; exit 1; }
bash deploy/scripts/tag-images.sh          # build com tag = git SHA (nunca :latest flutuante)
bash deploy/scripts/migrate-all.sh         # 9 domínios no aurumbit
bash deploy/scripts/seed-all.sh            # admin demo (troca de senha obrigatória) + catálogo mínimo
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml up -d
```

```bash
# Gate 5 — stack de pé, portas só em loopback, auto-cura ligada:
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml config | grep -i "127.0.0.1" | head -5
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml ps
curl -fsS http://localhost:3000/health/ready
bash deploy/scripts/backup-check.sh   # espera: done (ok: pg up + 9 schemas)
```

## 5. Pré-DNS → corte → TLS → smoke

DNS é o ÚLTIMO passo, não o primeiro — valide tudo com `--resolve`
antes de trocar qualquer registro (T4):

```bash
test -f deploy/scripts/pre-dns-check.sh || { echo "FAIL: pre-dns-check.sh ausente (T4)"; exit 1; }
bash deploy/scripts/pre-dns-check.sh --resolve
# equivale a: curl --resolve aurumbit.com:443:VPS_IP https://aurumbit.com/ etc. p/ os 3 hosts
```

Só com o `--resolve` verde: aponte os 3 hosts p/ `VPS_IP`, aguarde o
Caddy emitir os certificados e valide:

```bash
# Gate 6 — TLS:
curl -sI https://aurumbit.com/ | head -3                    # 200
curl -sI https://www.aurumbit.com/ | grep -i location       # redirect → apex
curl -sI https://api.aurumbit.com/health/live | head -1     # 200
echo | openssl s_client -connect aurumbit.com:443 2>/dev/null | openssl x509 -noout -dates
```

Smoke pós-deploy (T6) + URL de webhook confirmada no painel Asaas **prod**:

```bash
test -f deploy/scripts/smoke-prod.sh || { echo "FAIL: smoke-prod.sh ausente (T6)"; exit 1; }
bash deploy/scripts/smoke-prod.sh
# cobre: home 200, #produtos com dados da API, checkout mínimo + estorno,
# re-entrega de webhook duplicado → DUPLICATE sem 2ª cobrança/licença,
# login admin, /health/live
```

```bash
# Gate 7 — smoke verde + monitores externos (UptimeRobot/Better Stack nos 3 hosts):
curl -fsS https://api.aurumbit.com/health/live
# painel do monitor: 3 hosts UP
```

## 6. Backup cron + dead-man

Backup = DR, não dump local (T5): `pg_dump -Fc` ÚNICO do DB `aurumbit`
(peça restaurável) + `pg_dumpall -g` (roles) **cifrados** + cópia off-VPS
(`rclone` → S3/B2) + retenção 14d, incluindo `.env` e a mestra de licença
(`LICENSE_MASTER_KEY_PATH`) cifrados, com tamanho dos artefatos registrado.
Dead-man switch (Healthchecks.io ou similar): o cron pinga ao final;
sem ping em 24h → alerta.

```bash
# Gate 8 — backup do dia local + remoto + probe semanal agendado:
ls -lh /var/backups/aurum/ | tail -3
rclone ls remote:aurum-backups/ | tail -3
crontab -l | grep -E "backup|disk-check|restore"
```

Cron de disco (T1) — alerta WARN (exit 2) acima de 80%:

```bash
bash deploy/scripts/disk-check.sh; echo "exit=$?"
(crontab -l 2>/dev/null; echo "*/30 * * * * /srv/aurum/deploy/scripts/disk-check.sh >> /var/log/aurum-disk.log 2>&1") | crontab -
```

Simule a falha uma vez (mate o cron por 1 dia / pause o ping) e
confirme que o dead-man dispara — monitor não testado é decoração.

## 7. Rollback (reversível sem checkpoint — TTL 300 ajuda)

| Ação | Comando |
|---|---|
| App por tag anterior (SHAs retidos, T1) | `docker images \| grep aurum` → `TAG=<SHA-anterior> docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml up -d` |
| Caddy | `caddy reload --config deploy/Caddyfile` (valide antes: `caddy validate`) |
| DNS | reverta os 3 A-records; com TTL 300 propaga em minutos |

```bash
# Gate 9 pós-rollback: repita Gates 5–7 (ready + backup-check + smoke).
```

## 8. Clock-skew — NTP é obrigatório, não perfume

Billing e webhooks quebram com relógio dessincronizado: assinatura/
janela do webhook Asaas rejeita, `paidAt` diverge do PG (→ `REJECTED`
em massa no runbook de billing), reconciliação acusa divergência
fantasma. Por isso chrony + `timedatectl set-ntp true` estão no
harden-vps.sh, não como opcional:

```bash
# Gate 10 — relógio são:
timedatectl | grep -iE "NTP|synchronized"
chronyc tracking | grep -i "system time"
```

| Sintoma | Ação |
|---|---|
| `REJECTED` em massa logo após boot | `chronyc tracking` — offset alto? aguarde sync e faça replay manual (runbook billing §5) |
| `synchronized: no` persistente | provedora bloqueia NTP (porta 123 UDP)? abra no painel dela ou use `pool` alternativo no chrony |

## 9. `NEXT_PUBLIC_*` — assadas no build, rebuild obrigatório

Portal/admin rodam `next start`: toda troca de `NEXT_PUBLIC_*`
exige **rebuild da imagem** (`tag-images.sh`) + `up -d`. Nunca edite
o valor só no `.env` e espere efeito. Variáveis afetadas:

```bash
grep -rhoE "NEXT_PUBLIC_[A-Z_]+" apps/portal apps/admin --include="*.ts*" | sort -u
# ex.: NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SITE_URL
```

## 10. Checklist "terceiro executa só pelo doc"

- [ ] Cada comando acima é copiável (troque só `VPS_IP`, fingerprints, URL do repo).
- [ ] Cada gate tem assert com saída esperada explícita.
- [ ] One-way doors com checkpoint humano: corte DNS (§5), Asaas prod +
      primeira cobrança mínima com estorno (§5), mestra de licença
      (`LICENSE_MASTER_KEY_PATH`) off-VPS (§4), purge só com T5 recorrente (não ligue purge nesta fase).
- [ ] Pós-verde: troque a senha do admin demo no primeiro login, confirme
      reboot (`reboot` em janela + Gates 5–7 verdes sozinhos), registre
      clone→ready <10min (T8).
