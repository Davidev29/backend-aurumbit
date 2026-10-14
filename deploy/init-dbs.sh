#!/bin/sh
# deploy/init-dbs.sh — executado pelo entrypoint do Postgres (Fase 1).
# Cria as 9 databases de domínio Aurum Bit de forma idempotente.
set -e

# POSTGRES_USER / POSTGRES_DB vêm do environment do serviço postgres.
DB_USER="${POSTGRES_USER:-aurum}"

DBS="auth customers products access licensing billing finance audit communications"

for db in $DBS; do
  echo "Checking database: $db"
  EXISTS=$(psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" || echo "0")
  if [ "$EXISTS" = "1" ]; then
    echo "Database $db already exists, skipping."
  else
    echo "Creating database: $db"
    psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$db\";"
  fi
done

echo "init-dbs.sh done."
