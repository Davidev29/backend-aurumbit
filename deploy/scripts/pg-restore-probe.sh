#!/usr/bin/env bash
# deploy/scripts/pg-restore-probe.sh — Fase 7 T5. Prova de restore SEMANAL (não pontual).
#
# Pega o dump `aurum-<ts>.dump.gpg` mais recente (DB único `aurumbit`),
# descriptografa (valida passphrase + integridade), restaura em
# `restore_probe_aurumbit` com pg_restore e compara contra o DB vivo:
#   1. conjunto de tabelas de usuário idêntico (schema-qualificado,
#      `schemaname IN (9 schemas)`, não só SELECT 1);
#   2. row counts por tabela idênticos (contagens âncora, schema-qualificadas);
# DB vivo vazio (0 tabelas) + probe vazio = PASS com nota EMPTY (caso seed zerado).
# Probe SEMPRE dropado ao final (trap), PASS ou FAIL. Log em BACKUP_DIR/probe-<ts>.log.
# Agendamento: cron semanal (ver deploy/backup/README.md). Saída: 0 = PASS; 1 = FAIL.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/aurum}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${POSTGRES_USER:-aurum}"
export PGPASSWORD="${POSTGRES_PASSWORD:-aurum}"

SINGLE_DB="${SINGLE_DB:-aurumbit}"
PROBE_DB="restore_probe_aurumbit"
SCHEMA_LIST="'auth','customers','products','access','licensing','billing','finance','audit','communications'"
PROBE_LOG=""

: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE env obrigatória (vir de secret file, nunca argv)}"

log() {
  local msg="[probe] $*"
  echo "$msg"
  [ -n "$PROBE_LOG" ] && echo "$msg" >> "$PROBE_LOG"
}

decrypt_to() { # $1 src.gpg, $2 dst plain — passphrase via fd 3, nunca argv
  gpg --decrypt --batch --yes --pinentry-mode loopback \
    --passphrase-fd 3 --output "$2" "$1" 3< <(printf '%s' "$BACKUP_PASSPHRASE")
}

latest_ts() { # ts mais recente com peça única presente; FAIL se ausente
  local candidate
  candidate="$(ls "$BACKUP_DIR"/aurum-*.dump.gpg 2>/dev/null \
    | grep -v 'aurum-globals-' \
    | sed 's/.*aurum-\(.*\)\.dump\.gpg/\1/' | sort | tail -n 1 || true)"
  [ -n "$candidate" ] || { log "FAIL: nenhum dump aurum-*.dump.gpg em $BACKUP_DIR"; return 1; }
  [ -f "$BACKUP_DIR/aurum-$candidate.dump.gpg" ] || { log "FAIL: ts=$candidate sem peça única"; return 1; }
  echo "$candidate"
}

user_tables() { # $1 db -> lista ordenada schema.tabela (só os 9 schemas de domínio)
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -tAc \
    "SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname IN ($SCHEMA_LIST) ORDER BY 1;"
}

row_count() { # $1 db, $2 schema.tabela (schema-qualificado, parte a parte entre aspas)
  local schema="${2%%.*}" table="${2#*.}"
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -tAc "SELECT count(*) FROM \"$schema\".\"$table\";"
}

drop_probe() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='$PROBE_DB'" | grep -q 1 \
    && dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PROBE_DB" \
    && log "probe drop: $PROBE_DB" || true
}

main() {
  local ts
  ts="$(latest_ts)" || { echo "[probe] FAIL: sem dump restaurável" >&2; exit 1; }
  PROBE_LOG="$BACKUP_DIR/probe-$ts.log"
  : > "$PROBE_LOG"
  log "start ts=$ts (peça única $SINGLE_DB) — probe: $PROBE_DB (drop garantido via trap)"
  trap drop_probe EXIT
  local src="$BACKUP_DIR/aurum-$ts.dump.gpg" tmp live_tables probe_tables
  tmp="$(mktemp)"
  decrypt_to "$src" "$tmp" || { log "FAIL: descriptografia falhou"; rm -f "$tmp"; exit 1; }
  dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$PROBE_DB" >/dev/null 2>&1 || true
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PROBE_DB" \
    || { log "FAIL: createdb $PROBE_DB"; rm -f "$tmp"; exit 1; }
  if ! pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PROBE_DB" --no-owner "$tmp" >>"$PROBE_LOG" 2>&1; then
    log "FAIL: pg_restore falhou (detalhe no log)"
    rm -f "$tmp"
    exit 1
  fi
  rm -f "$tmp"
  live_tables="$(user_tables "$SINGLE_DB")"
  probe_tables="$(user_tables "$PROBE_DB")"
  if [ "$live_tables" != "$probe_tables" ]; then
    log "FAIL: tabelas divergem vivo<>probe"
    log "FAIL: vivo=[$(echo "$live_tables" | tr '\n' ' ')] probe=[$(echo "$probe_tables" | tr '\n' ' ')]"
    exit 1
  fi
  if [ -z "$live_tables" ]; then
    log "PASS: EMPTY (0 tabelas no vivo e no probe)"
    exit 0
  fi
  local t live_n probe_n
  for t in $live_tables; do
    live_n="$(row_count "$SINGLE_DB" "$t")"
    probe_n="$(row_count "$PROBE_DB" "$t")"
    if [ "$live_n" != "$probe_n" ]; then
      log "FAIL [$t]: count vivo=$live_n probe=$probe_n"
      exit 1
    fi
  done
  local ntables
  ntables="$(echo "$live_tables" | wc -l | tr -d ' ')"
  log "PASS: $ntables tabelas, counts idênticos"
  trap - EXIT
  drop_probe
  log "result: PASS (log: $PROBE_LOG)"
}

main "$@"
