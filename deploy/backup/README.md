# Backup & DR — Aurum Bit (Fase 7 T5)

DR real, não dump local: dump diário **cifrado** (contém PII) + **cópia off-VPS**
+ restore probe **semanal** + dead-man switch. Purge automático: **PROIBIDO**
nesta fase (retention SQL com nomes errados — §8 do PHASE-7-PLAN; gate §6 exige
T5 verde recorrente antes de qualquer purge).

## Peças

| Script | Papel |
|---|---|
| `deploy/scripts/pg-backup.sh` | Dump diário: `pg_dump -Fc` ÚNICO do DB `aurumbit` (peça restaurável) + `pg_dumpall -g` (só roles/globals), tudo `gpg AES-256`, `sizes.log`, retenção local 14d, `rclone copy`, snapshot `.env.prod` cifrado + nota `LICENSE_MASTER_KEY_PATH`, ping Healthchecks |
| `deploy/scripts/pg-restore-probe.sh` | Prova semanal: descriptografa, `pg_restore` em `restore_probe_aurumbit`, compara **tabelas (schema-qualificadas, 9 schemas) + row counts** vivo×probe, drop garantido, log `probe-<ts>.log` |
| `deploy/scripts/backup-check.sh` | Veredito rápido: pg+9 schemas = FAIL hard (Fase 6, inalterado); dump do dia local/remoto = **WARN** até T5 verde recorrente |

Nomes: `BACKUP_DIR/aurum-<UTC:YYYYMMDDTHHMMSSZ>.dump.gpg` (peça única) +
`BACKUP_DIR/aurum-globals-<UTC>.sql.gz.gpg` (roles),
`env-<UTC>.gpg` + `env-<UTC>.note` (`LICENSE_MASTER_KEY_PATH=present|MISSING` — valor nunca em claro).

## Segredos (nunca commitar)

- `BACKUP_PASSPHRASE`: de secret file na VPS (`/run/secrets/backup-passphrase`,
  `chmod 600`, dono do cron user). Nunca argv, nunca log.
- `HC_PING_URL`: URL do check Healthchecks.io (ex.: `https://hc-ping.com/<uuid>`).
- `RCLONE_REMOTE`: nome do remote rclone (default `offsite` → `offsite:aurum-backups`).

## Cron exato (VPS, usuário `aurum`, fuso UTC no exemplo)

```cron
# Diário 02:00 UTC — backup (passphrase via secret file, nunca inline)
0 2 * * * export BACKUP_PASSPHRASE="$(cat /run/secrets/backup-passphrase)" HC_PING_URL="https://hc-ping.com/<uuid-backup>" RCLONE_REMOTE="offsite" BACKUP_DIR="/var/backups/aurum" ENV_FILE="/srv/aurum/.env.prod" && /srv/aurum/deploy/scripts/pg-backup.sh >> /var/log/aurum/pg-backup.log 2>&1

# Semanal domingo 04:00 UTC — restore probe (check HC separado, para distinguir backup×probe)
0 4 * * 0 export BACKUP_PASSPHRASE="$(cat /run/secrets/backup-passphrase)" BACKUP_DIR="/var/backups/aurum" && /srv/aurum/deploy/scripts/pg-restore-probe.sh >> /var/log/aurum/pg-restore-probe.log 2>&1
```

Saída `pg-backup.sh`: `0` = ok total; `2` = degradado (local OK, offsite falhou —
investigar remote); `1` = falha (ping `/fail` + sem dumps confiáveis).

## Simulação de falha do dead-man (gate T5)

1. Desabilite o cron por 1 dia: `crontab -e` → comente a linha `0 2 * * * …pg-backup.sh`
   (ou `systemctl stop cron` na janela — prefira comentar a linha).
2. Aguarde o período do check Healthchecks (24h / `grace` configurado).
3. Resultado esperado: **alerta do Healthchecks** (e-mail/Slack/PagerDuty do canal
   configurado) por ausência de ping — sem ping em 24h → alerta.
4. Reabilite o cron, confirme o próximo ping `ok` no dashboard do check.
5. Variante falha-aberta: `RCLONE_REMOTE` inválido → backup sai `2`, ping vai para
   `<HC_PING_URL>/fail` (estado distinto de "sem ping"), dumps locais intactos.

## Restauração manual (passo a passo)

```bash
# 1. Localize o ts (local ou off-VPS)
ls -t /var/backups/aurum/aurum-*.dump.gpg | grep -v globals | head -1
rclone lsl offsite:aurum-backups | sort -r | head -20

# 2. Traga do remoto se preciso + descriptografe (passphrase via fd, nunca argv)
export BACKUP_PASSPHRASE="$(cat /run/secrets/backup-passphrase)"
TS=20261014T020000Z
rclone copy "offsite:aurum-backups/aurum-$TS.dump.gpg" /tmp/restore/
printf '%s' "$BACKUP_PASSPHRASE" | gpg --decrypt --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 --output /tmp/restore/aurumbit.dump /tmp/restore/aurum-$TS.dump.gpg

# 3. Restaure num DB NOVO primeiro (nunca por cima do vivo sem checkpoint humano)
createdb -h localhost -U aurum "aurumbit_manual_restore"
pg_restore -h localhost -U aurum -d "aurumbit_manual_restore" --no-owner /tmp/restore/aurumbit.dump

# 4. Confira (tabelas schema-qualificadas + counts contra o vivo) e só então promova (rename / cutover)
# 5. Roles/globals (se cluster novo): descriptografe aurum-globals-$TS.sql.gz.gpg,
#    gunzip e aplique as seções de ROLE necessárias com revisão (não psql -f cego).

# 6. Segredo crítico: descriptografe env-$TS.gpg e confira a mestra de licença
printf '%s' "$BACKUP_PASSPHRASE" | gpg --decrypt --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 --output /tmp/restore/env /tmp/restore/env-$TS.gpg
grep -c '^LICENSE_MASTER_KEY_PATH=.\+' /tmp/restore/env  # 1 = presente
shred -u /tmp/restore/env /tmp/restore/aurumbit.dump  # limpe plains após uso
```

## Limites conhecidos (não-silenciosos)

- Sem rclone/remote: backup sai `2` + ping `/fail` — fail-open com alerta, nunca verde falso.
- `backup-check.sh` dá WARN (não FAIL) para dumps até T5 verde recorrente — decisão
  registrada no topo do script; virar FAIL hard é o ato que marca "T5 verde".
- Retenção 14d aplica-se **só aos artefatos de backup locais**; purge de dados de
  negócio continua proibido.
