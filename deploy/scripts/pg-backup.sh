#!/usr/bin/env bash
# deploy/scripts/pg-backup.sh — Fase 7 T5. DR backup diário: dump CIFRADO + cópia off-VPS + dead-man.
#
# O que faz (nesta ordem):
#   1. `pg_dump -Fc` ÚNICO do DB `aurumbit` (peça restaurável pelo probe via
#      `pg_restore`). É esta peça que o restore probe
#      (`pg-restore-probe.sh`) usa.
#   2. `pg_dumpall -g` (só roles/globals, sem dados) `| gzip` — peça
#      complementar p/ cluster novo.
#   3. Cifra TUDO com gpg AES-256 simétrico (pass via fd dedicado, nunca argv nem log).
#   4. Snapshot cifrado do `.env.prod` + nota de presença da mestra de licença
#      (presente/ausente — o VALOR nunca é logado).
#   5. Registra tamanhos em BACKUP_DIR/sizes.log; retenção local 14d (find -delete).
#   6. Cópia off-VPS via `rclone copy` (fail-open COM alerta, nunca silencioso).
#   7. Ping dead-man Healthchecks.io: base = OK, /fail = degradado/falha (distintos).
#
# Env:
#   BACKUP_PASSPHRASE (obrigatória) — nunca passar via argv; vir de secret file / vault.
#   BACKUP_DIR (default /var/backups/aurum), RETENTION_DAYS (default 14),
#   PGHOST/PGPORT/POSTGRES_USER/POSTGRES_PASSWORD, SINGLE_DB (default aurumbit),
#   RCLONE_REMOTE (default "offsite"; destino "<remote>:aurum-backups"),
#   ENV_FILE (default /srv/aurum/.env.prod), HC_PING_URL (default vazio = sem ping).
# Saída: 0 = ok total; 2 = degradado (local OK, offsite falhou); 1 = falha.
# NUNCA: commitar dumps/passphrase/.env; purge automático; logar PII/segredos.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/aurum}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${POSTGRES_USER:-aurum}"
export PGPASSWORD="${POSTGRES_PASSWORD:-aurum}"
RCLONE_REMOTE="${RCLONE_REMOTE:-offsite}"
ENV_FILE="${ENV_FILE:-/srv/aurum/.env.prod}"
HC_PING_URL="${HC_PING_URL:-}"

SINGLE_DB="${SINGLE_DB:-aurumbit}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE env obrigatória (vir de secret file, nunca argv)}"

log() { echo "[pg-backup] $*"; }

ping_ok() {
  [ -n "$HC_PING_URL" ] || return 0
  curl -fsS -m 10 --retry 3 -X POST --data-raw "ok ts=$TS" "$HC_PING_URL" -o /dev/null \
    || log "WARN: ping dead-man OK falhou (rede?)"
}

ping_fail() { # $1 = motivo curto, sem segredos
  [ -n "$HC_PING_URL" ] || return 0
  curl -fsS -m 10 --retry 3 -X POST --data-raw "fail ts=$TS: $1" "$HC_PING_URL/fail" -o /dev/null \
    || log "WARN: ping dead-man FAIL também falhou (rede?)"
}

die() {
  log "FATAL: $*"
  ping_fail "$*"
  exit 1
}

check_deps() {
  for bin in pg_dumpall pg_dump gzip gpg find date; do
    command -v "$bin" >/dev/null 2>&1 || die "dependência ausente: $bin"
  done
  mkdir -p "$BACKUP_DIR"
}

encrypt_file() { # $1 src plain (será removido), $2 dst .gpg — passphrase via fd 3, nunca argv
  local src="$1" dst="$2"
  gpg --symmetric --cipher-algo AES256 --batch --yes --pinentry-mode loopback \
    --passphrase-fd 3 --output "$dst" "$src" 3< <(printf '%s' "$BACKUP_PASSPHRASE")
  rm -f "$src"
}

record_size() { # $1 arquivo final
  local f="$1" bytes
  bytes="$(wc -c < "$f" | tr -d ' ')"
  echo "$TS $bytes $(basename "$f")" >> "$BACKUP_DIR/sizes.log"
  log "size: $(basename "$f") = $bytes bytes"
}

dump_single_db() { # pg_dump -Fc único do DB aurumbit -> cifra (peça restaurável pelo probe)
  local plain="$BACKUP_DIR/.tmp-aurum-$TS.dump" out="$BACKUP_DIR/aurum-$TS.dump.gpg"
  log "dump -Fc: $SINGLE_DB…"
  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -Fc -f "$plain" "$SINGLE_DB" \
    || die "pg_dump -Fc falhou: $SINGLE_DB"
  encrypt_file "$plain" "$out"
  record_size "$out"
}

dump_globals() { # roles/globals (pg_dumpall -g, sem dados) -> gzip -> cifra
  local plain="$BACKUP_DIR/.tmp-aurum-globals-$TS.sql" gz="$plain.gz" out="$BACKUP_DIR/aurum-globals-$TS.sql.gz.gpg"
  log "dump globals (pg_dumpall -g | gzip)…"
  pg_dumpall -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -g > "$plain" \
    || die "pg_dumpall -g falhou"
  gzip -c "$plain" > "$gz"; rm -f "$plain"
  encrypt_file "$gz" "$out"
  record_size "$out"
}

snapshot_env() { # .env.prod cifrado + nota de presença da mestra (valor NUNCA logado)
  [ -f "$ENV_FILE" ] || { log "WARN: ENV_FILE ausente ($ENV_FILE) — snapshot pulado"; return 0; }
  local out="$BACKUP_DIR/env-$TS.gpg" note="$BACKUP_DIR/env-$TS.note"
  gpg --symmetric --cipher-algo AES256 --batch --yes --pinentry-mode loopback \
    --passphrase-fd 3 --output "$out" "$ENV_FILE" 3< <(printf '%s' "$BACKUP_PASSPHRASE")
  record_size "$out"
  if grep -q '^LICENSE_MASTER_KEY_PATH=.\+' "$ENV_FILE"; then
    echo "$TS LICENSE_MASTER_KEY_PATH=present" > "$note"
  else
    echo "$TS LICENSE_MASTER_KEY_PATH=MISSING" > "$note"
    log "WARN: LICENSE_MASTER_KEY_PATH ausente no $ENV_FILE (§6: sem ela, licenças indecifráveis)"
  fi
  chmod 600 "$out" "$note"
}

prune_local() { # retenção 14d — SÓ artefatos do padrão aurum-*/env-*; NUNCA purge de dados
  log "retenção local: -mtime +$RETENTION_DAYS -delete em $BACKUP_DIR"
  find "$BACKUP_DIR" -maxdepth 1 -type f \
    \( -name 'aurum-*.dump.gpg' -o -name 'aurum-globals-*.sql.gz.gpg' -o -name 'env-*.gpg' -o -name 'env-*.note' \) \
    -mtime +"$RETENTION_DAYS" -print -delete || die "prune local falhou"
}

copy_offsite() { # fail-open COM alerta: retorna 1 se remote ausente/falhou (nunca silencioso)
  if ! command -v rclone >/dev/null 2>&1; then
    log "WARN: rclone ausente — cópia off-VPS PULADA (instalar + configurar remote '$RCLONE_REMOTE')"
    return 1
  fi
  if [ -z "$RCLONE_REMOTE" ]; then
    log "WARN: RCLONE_REMOTE vazio — cópia off-VPS PULADA"
    return 1
  fi
  rclone lsd "$RCLONE_REMOTE:" >/dev/null 2>&1 \
    || { log "WARN: remote rclone '$RCLONE_REMOTE' inalcançável — cópia PULADA"; return 1; }
  # shellcheck disable=SC2046
  rclone copy --include "aurum-$TS*.gpg" --include "aurum-globals-$TS*.gpg" --include "env-$TS.*" \
    "$BACKUP_DIR" "$RCLONE_REMOTE:aurum-backups" \
    || { log "WARN: rclone copy falhou (ts=$TS)"; return 1; }
  log "offsite: ts=$TS copiado para $RCLONE_REMOTE:aurum-backups"
  return 0
}

main() {
  log "start ts=$TS db=$SINGLE_DB dir=$BACKUP_DIR retention=${RETENTION_DAYS}d remote=$RCLONE_REMOTE"
  check_deps
  dump_single_db
  dump_globals
  snapshot_env
  prune_local
  if copy_offsite; then
    log "done OK (local + offsite)"
    ping_ok
    exit 0
  else
    log "done DEGRADADO: dumps locais OK, off-VPS FALHOU — investigar remote '$RCLONE_REMOTE'"
    ping_fail "offsite copy failed ts=$TS"
    exit 2
  fi
}

main "$@"
