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

# DDL de particionamento declarativo exige ACCESS EXCLUSIVE e NÃO pode passar
# por PgBouncer (transaction mode). `DATABASE_URL_AUDIT` aponta para a role
# `app_audit_append` (só GRANT SELECT, INSERT) — com ela o CREATE TABLE
# ... PARTITION OF morre em `permission denied` e a partição NUNCA é criada.
# Usa a URL do role `migrator` (DDL), porta 5432 direta (mesmo papel do
# grant-repair em migrate-all.sh).
MIG_URL="${MIGRATOR_DATABASE_URL:-}"
if [ -z "$MIG_URL" ]; then
  echo "ERRO: MIGRATOR_DATABASE_URL ausente — CREATE TABLE ... PARTITION OF exige role com DDL." >&2
  echo "      NAO usar DATABASE_URL_AUDIT (role app_audit_append via PgBouncer): a particao nunca seria criada." >&2
  exit 1
fi

psql_audit() {
  if command -v psql >/dev/null 2>&1; then
    psql -v ON_ERROR_STOP=1 "$MIG_URL" -c "$1"
  elif command -v docker >/dev/null 2>&1; then
    # Sem `psql` local (ex.: Windows dev): executa dentro do container do
    # Postgres (container_name fixo `aurum-postgres`, salvo PG_CONTAINER),
    # com as credenciais do role migrator (DDL).
    printf '%s\n' "$1" | docker exec -i -e PGPASSWORD="${MIGRATOR_PASSWORD:-dev_migrator_pw}" \
      "${PG_CONTAINER:-aurum-postgres}" \
      psql -v ON_ERROR_STOP=1 -U migrator -d aurumbit
  else
    echo "ERRO: psql e docker ausentes — nao ha como criar as particoes declarativas." >&2
    exit 1
  fi
}

for tbl in audit_events security_events; do
  echo "==> partition audit.${tbl}_${SUFFIX} [${NEXT_START}..${NEXT_END})"
  psql_audit "CREATE TABLE IF NOT EXISTS audit.${tbl}_${SUFFIX} PARTITION OF audit.${tbl} FOR VALUES FROM ('${NEXT_START}') TO ('${NEXT_END}');"
done

echo "audit-partition OK (${SUFFIX})"
