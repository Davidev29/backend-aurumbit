#!/usr/bin/env bash
# deploy/scripts/audit-partition.sh — E6 (Fase 9). Cria a partição do MÊS
# SEGUINTE de audit.audit_events + audit.security_events. Idempotente
# (CREATE TABLE IF NOT EXISTS ... PARTITION OF ...): seguro rodar todo dia.
# Cron mensal (documentado em docs/RUNBOOKS/audit.md):
#   0 3 1 * *  /opt/aurum/deploy/scripts/audit-partition.sh >> /var/log/aurum/audit-partition.log 2>&1
# Também chamado no fim de migrate-all.sh como safety (nunca falha o deploy).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

# Mês seguinte a partir do dia 01 do mês corrente (GNU date).
NEXT_START="$(date -d "$(date +%Y-%m-01) +1 month" +%Y-%m-%d)"
NEXT_END="$(date -d "$NEXT_START +1 month" +%Y-%m-%d)"
SUFFIX="$(date -d "$NEXT_START" +%Y_%m)"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${POSTGRES_USER:-aurum}"
export PGPASSWORD="${POSTGRES_PASSWORD:-aurum}"

psql_audit() {
  if [ -n "${DATABASE_URL_AUDIT:-}" ] && command -v psql >/dev/null 2>&1; then
    psql -v ON_ERROR_STOP=1 "$DATABASE_URL_AUDIT" -c "$1"
  elif command -v docker >/dev/null 2>&1; then
    # Sem `psql` local (ex.: Windows dev): executa dentro do container do
    # Postgres (container_name fixo `aurum-postgres`, salvo PG_CONTAINER).
    PG_CONTAINER="${PG_CONTAINER:-aurum-postgres}"
    printf '%s\n' "$1" | docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD:-aurum}" \
      "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-aurum}" -d aurumbit
  elif [ -n "${DATABASE_URL_AUDIT:-}" ]; then
    psql -v ON_ERROR_STOP=1 "$DATABASE_URL_AUDIT" -c "$1"
  else
    psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d audit -c "$1"
  fi
}

for tbl in audit_events security_events; do
  echo "==> partition audit.${tbl}_${SUFFIX} [${NEXT_START}..${NEXT_END})"
  psql_audit "CREATE TABLE IF NOT EXISTS audit.${tbl}_${SUFFIX} PARTITION OF audit.${tbl} FOR VALUES FROM ('${NEXT_START}') TO ('${NEXT_END}');"
done

echo "audit-partition OK (${SUFFIX})"
