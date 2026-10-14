#!/usr/bin/env bash
# deploy/scripts/pg-restore-probe.sh — Fase 7 T5. Prova de restore SEMANAL (não pontual).
#
# Pega o timestamp mais recente com as 9 peças `aurum-<ts>-<db>.dump.gpg` do dia,
# descriptografa (valida passphrase + integridade), restaura cada uma em
# `restore_probe_<db>` com pg_restore e compara contra o DB vivo:
#   1. conjunto de tabelas de usuário idêntico (não só SELECT 1);
#   2. row counts por tabela idênticos (contagens âncora);
# DB vivo vazio (0 tabelas) + probe vazio = PASS com nota EMPTY (caso seed zerado).
# Probes SEMPRE dropados ao final (trap), PASS ou FAIL. Log em BACKUP_DIR/probe-<ts>.log.
# Agendamento: cron semanal (ver deploy/backup/README.md). Saída: 0 = 9/9 PASS; 1 = FAIL.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/aurum}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${POSTGRES_USER:-aurum}"
export PGPASSWORD="${POSTGRES_PASSWORD:-aurum}"

DBS="auth customers products access licensing billing finance audit communications"
PREFIX="restore_probe_"
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

latest_ts() { # ts mais recente com as 9 peças presentes; FAIL se incompleto
  local ts candidate missing
  candidate="$(ls "$BACKUP_DIR"/aurum-*-auth.dump.gpg 2>/dev/null \
    | sed 's/.*aurum-\(.*\)-auth\.dump\.gpg/\1/' | sort | tail -n 1 || true)"
  [ -n "$candidate" ] || { log "FAIL: nenhum dump *-auth.dump.gpg em $BACKUP_DIR"; return 1; }
  missing=""
  for db in $DBS; do
    [ -f "$BACKUP_DIR/aurum-$candidate-$db.dump.gpg" ] || missing="$missing $db"
  done
  if [ -n "$missing" ]; then
    log "FAIL: ts=$candidate incompleto, peças ausentes:$missing"
    return 1
  fi
  echo "$candidate"
}

user_tables() { # $1 db -> lista ordenada de tabelas de usuário
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -tAc \
    "SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1;"
}

row_count() { # $1 db, $2 tabela
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -tAc "SELECT count(*) FROM \"$2\";"
}

drop_probes() {
  for db in $DBS; do
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='$PREFIX$db'" | grep -q 1 \
      && dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PREFIX$db" \
      && log "probe drop: $PREFIX$db" || true
  done
}

probe_one_db() { # $1 db, $2 ts -> 0 PASS / 1 FAIL (compara schema + counts, não só SELECT 1)
  local db="$1" ts="$2" probe="$PREFIX$1"
  local src="$BACKUP_DIR/aurum-$ts-$db.dump.gpg" tmp live_tables probe_tables
  tmp="$(mktemp)"
  decrypt_to "$src" "$tmp" || { log "FAIL [$db]: descriptografia falhou"; rm -f "$tmp"; return 1; }
  dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$probe" >/dev/null 2>&1 || true
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$probe" \
    || { log "FAIL [$db]: createdb $probe"; rm -f "$tmp"; return 1; }
  if ! pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$probe" --no-owner "$tmp" >>"$PROBE_LOG" 2>&1; then
    log "FAIL [$db]: pg_restore falhou (detalhe no log)"
    rm -f "$tmp"
    return 1
  fi
  rm -f "$tmp"
  live_tables="$(user_tables "$db")"
  probe_tables="$(user_tables "$probe")"
  if [ "$live_tables" != "$probe_tables" ]; then
    log "FAIL [$db]: tabelas divergem vivo<>probe"
    log "FAIL [$db]: vivo=[$(echo "$live_tables" | tr '\n' ' ')] probe=[$(echo "$probe_tables" | tr '\n' ' ')]"
    return 1
  fi
  if [ -z "$live_tables" ]; then
    log "PASS [$db]: EMPTY (0 tabelas no vivo e no probe)"
    return 0
  fi
  local t live_n probe_n
  for t in $live_tables; do
    live_n="$(row_count "$db" "$t")"
    probe_n="$(row_count "$probe" "$t")"
    if [ "$live_n" != "$probe_n" ]; then
      log "FAIL [$db.$t]: count vivo=$live_n probe=$probe_n"
      return 1
    fi
  done
  local ntables
  ntables="$(echo "$live_tables" | wc -l | tr -d ' ')"
  log "PASS [$db]: $ntables tabelas, counts idênticos"
  return 0
}

main() {
  local ts pass=0 fail=0
  ts="$(latest_ts)" || { echo "[probe] FAIL: sem dump restaurável" >&2; exit 1; }
  PROBE_LOG="$BACKUP_DIR/probe-$ts.log"
  : > "$PROBE_LOG"
  log "start ts=$ts (dump do dia) — probes: ${PREFIX}* (drop garantido via trap)"
  trap drop_probes EXIT
  for db in $DBS; do
    if probe_one_db "$db" "$ts"; then
      pass=$((pass + 1))
    else
      fail=$((fail + 1))
    fi
  done
  trap - EXIT
  drop_probes
  log "result: PASS=$pass FAIL=$fail (log: $PROBE_LOG)"
  [ "$fail" -eq 0 ]
}

main "$@"
