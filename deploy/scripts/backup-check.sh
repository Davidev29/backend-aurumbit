#!/bin/sh
# deploy/scripts/backup-check.sh — Fase 6 (pg+9 DBs, hard FAIL) + Fase 7 T5 (dumps, WARN).
# Compatibilidade Fase 6: o veredito FAIL continua decidido SÓ por pg_isready e
# pelas 9 DBs. Tudo de T5 (dump do dia local/remoto, restore probe) é WARN —
# nunca FAIL hard — até T5 verde recorrente (decisão T5: evitar falso-vermelho no
# CI enquanto o backup diário ainda está em burn-in; ver deploy/backup/README.md).
# Restore real: pg-restore-probe.sh (semanal, 9 DBs + counts); este script só
# verifica a EXISTÊNCIA do dump do dia. Purge automático: PROIBIDO (§8/retention).
set -e

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${POSTGRES_USER:-aurum}"
export PGPASSWORD="${POSTGRES_PASSWORD:-aurum}"

EXPECTED="auth customers products access licensing billing finance audit communications"

echo "[backup-check] Aurum Bit — Fase 6 (pg_isready + 9 DBs + restore TODO)"

if ! command -v psql >/dev/null 2>&1; then
  echo "[backup-check] psql não encontrado no host — pule (CI usa pg_isready no container)."
  echo "[backup-check] esperado: $EXPECTED"
  exit 0
fi

echo "[backup-check] pg_isready: $PGHOST:$PGPORT"
pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" || {
  echo "[backup-check] FAIL: postgres inalcançável"
  exit 1
}

echo "[backup-check] databases:"
FOUND="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -tAc "SELECT datname FROM pg_database WHERE datname IN ('auth','customers','products','access','licensing','billing','finance','audit','communications') ORDER BY 1;" | tr '\n' ' ' | tr -s ' ')"
echo "[backup-check] found: $FOUND"
COUNT="$(echo "$FOUND" | wc -w | tr -d ' ')"
if [ "$COUNT" != "9" ]; then
  echo "[backup-check] FAIL: esperadas 9 DBs ($EXPECTED); encontradas $COUNT ($FOUND)"
  exit 1
fi

# --- T5: dump do dia local + remoto (WARN, nunca FAIL hard — decisão T5, ver topo) ---
# Artefatos: BACKUP_DIR/aurum-<UTC>-<db>.dump.gpg (9 peças) + aurum-<UTC>.dump.gpg
# (cluster). Produzidos por pg-backup.sh; restaurados por pg-restore-probe.sh.
TODAY="$(date -u +%Y%m%d)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/aurum}"
if [ -d "$BACKUP_DIR" ]; then
  MISSING=""
  for db in $EXPECTED; do
    if ! ls "$BACKUP_DIR"/aurum-"$TODAY"*-"$db".dump.gpg >/dev/null 2>&1; then
      MISSING="$MISSING $db"
    fi
  done
  if [ -z "$MISSING" ]; then
    echo "[backup-check] dump do dia local: OK ($TODAY, 9 peças)"
  else
    echo "[backup-check] WARN: dump do dia local ausente para:$MISSING (pg-backup.sh ainda não rodou hoje?)"
  fi
  if ! ls "$BACKUP_DIR"/aurum-"$TODAY"*.dump.gpg >/dev/null 2>&1; then
    echo "[backup-check] WARN: nenhum dump .gpg de hoje em $BACKUP_DIR"
  fi
else
  echo "[backup-check] WARN: BACKUP_DIR ausente ($BACKUP_DIR) — backup diário ainda não configurado"
fi
if command -v rclone >/dev/null 2>&1 && [ -n "${RCLONE_REMOTE:-}" ]; then
  if rclone lsl "${RCLONE_REMOTE}:aurum-backups" 2>/dev/null | grep -q "$TODAY"; then
    echo "[backup-check] dump do dia remoto: OK ($RCLONE_REMOTE:aurum-backups)"
  else
    echo "[backup-check] WARN: dump do dia NÃO encontrado no remoto ${RCLONE_REMOTE}:aurum-backups"
  fi
else
  echo "[backup-check] WARN: remoto off-VPS não verificável (rclone ausente ou RCLONE_REMOTE vazio)"
fi

# --- Restore probe (T5 real; antes era TODO Fase 6 — FECHADO por pg-restore-probe.sh) ---
# O probe executável mora em deploy/scripts/pg-restore-probe.sh (cron semanal,
# 9 DBs + comparação de tabelas e counts, drop garantido). Aqui, só eco de status.
if [ "${BACKUP_RESTORE_TEST:-0}" = "1" ]; then
  echo "[backup-check] restore: executável via pg-restore-probe.sh (BACKUP_DIR=${BACKUP_DIR:-<unset>})"
fi

echo "[backup-check] done (ok: pg up + 9 DBs; dumps T5 = WARN até verde recorrente)."
