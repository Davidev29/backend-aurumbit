#!/bin/sh
# deploy/init-dbs.sh — bootstrap do banco consolidado (E2/E3, idempotente).
# Garante CREATE DATABASE aurumbit e aplica init-consolidated.sql com as
# senhas por role vindas de env (APP_*_PASSWORD / MIGRATOR_PASSWORD).
# DEV: defaults fracos locais abaixo (nunca usar em prod).
# PROD: .env.prod gerado por deploy/scripts/gen-prod-env.sh (hex URL-safe).
# Restrição: senhas precisam ser URL-safe (sem `@`, `/`, `+`, `:`) pois são
# interpoladas nas DATABASE_URL_* e passadas via psql `-v`.
set -e

DB_USER="${POSTGRES_USER:-aurum}"
DB_NAME="${POSTGRES_DB:-aurumbit}"

MIGRATOR_PASSWORD="${MIGRATOR_PASSWORD:-dev_migrator_pw}"
APP_AUTH_PASSWORD="${APP_AUTH_PASSWORD:-dev_auth_pw}"
APP_CUSTOMERS_PASSWORD="${APP_CUSTOMERS_PASSWORD:-dev_customers_pw}"
APP_PRODUCTS_PASSWORD="${APP_PRODUCTS_PASSWORD:-dev_products_pw}"
APP_ACCESS_PASSWORD="${APP_ACCESS_PASSWORD:-dev_access_pw}"
APP_LICENSING_PASSWORD="${APP_LICENSING_PASSWORD:-dev_licensing_pw}"
APP_BILLING_PASSWORD="${APP_BILLING_PASSWORD:-dev_billing_pw}"
APP_COMMUNICATIONS_PASSWORD="${APP_COMMUNICATIONS_PASSWORD:-dev_comms_pw}"
APP_FINANCE_PASSWORD="${APP_FINANCE_PASSWORD:-dev_finance_pw}"
APP_FINANCE_REPORTS_PASSWORD="${APP_FINANCE_REPORTS_PASSWORD:-dev_finrep_pw}"
APP_AUDIT_APPEND_PASSWORD="${APP_AUDIT_APPEND_PASSWORD:-dev_audit_append_pw}"
APP_AUDIT_READ_PASSWORD="${APP_AUDIT_READ_PASSWORD:-dev_audit_read_pw}"

# init-consolidated.sql: no container vive em /opt (mount do compose);
# fora do container, cai para o mesmo diretório deste script.
SQL_FILE="${INIT_CONSOLIDATED_SQL:-/opt/init-consolidated.sql}"
if [ ! -f "$SQL_FILE" ]; then
  DIR="$(cd "$(dirname "$0")" && pwd)"
  SQL_FILE="$DIR/init-consolidated.sql"
fi

echo "Checking database: $DB_NAME"
EXISTS=$(psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" || echo "0")
if [ "$EXISTS" = "1" ]; then
  echo "Database $DB_NAME already exists, skipping CREATE."
else
  echo "Creating database: $DB_NAME"
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB_NAME\";"
fi

echo "Applying consolidated init: $SQL_FILE"
psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f "$SQL_FILE" \
  -v migrator_password="$MIGRATOR_PASSWORD" \
  -v app_auth_password="$APP_AUTH_PASSWORD" \
  -v app_customers_password="$APP_CUSTOMERS_PASSWORD" \
  -v app_products_password="$APP_PRODUCTS_PASSWORD" \
  -v app_access_password="$APP_ACCESS_PASSWORD" \
  -v app_licensing_password="$APP_LICENSING_PASSWORD" \
  -v app_billing_password="$APP_BILLING_PASSWORD" \
  -v app_communications_password="$APP_COMMUNICATIONS_PASSWORD" \
  -v app_finance_password="$APP_FINANCE_PASSWORD" \
  -v app_finance_reports_password="$APP_FINANCE_REPORTS_PASSWORD" \
  -v app_audit_append_password="$APP_AUDIT_APPEND_PASSWORD" \
  -v app_audit_read_password="$APP_AUDIT_READ_PASSWORD"

# Banco de sombra do Prisma (DEV): `prisma migrate dev` e `migrate diff
# --from-migrations` exigem um shadow database. O role `migrator` NAO tem
# CREATEDB (least-privilege), entao o banco precisa existir de antemao; sem
# ele o Prisma falha com:
#   FATAL: database "aurumbit_shadow" does not exist
# Criado DEPOIS do init-consolidated.sql (que cria o role `migrator`).
SHADOW_DB="${SHADOW_DB_NAME:-${DB_NAME}_shadow}"
SHADOW_EXISTS=$(psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$SHADOW_DB'" || echo "0")
if [ "$SHADOW_EXISTS" = "1" ]; then
  echo "Shadow database $SHADOW_DB already exists, skipping CREATE."
else
  echo "Creating shadow database: $SHADOW_DB"
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$SHADOW_DB\" OWNER migrator;"
fi

echo "init-dbs.sh done."
