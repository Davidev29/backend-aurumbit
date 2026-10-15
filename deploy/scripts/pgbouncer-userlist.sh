#!/bin/sh
# deploy/scripts/pgbouncer-userlist.sh — materializa deploy/pgbouncer/userlist.txt
# (Fase 9 E3, ADR-006). O compose monta ./pgbouncer em /etc/pgbouncer:ro e o
# pgbouncer exige auth_file com as 12 roles; sem o arquivo ele recusa auth no boot.
# Uso: APP_*_PASSWORD=... bash deploy/scripts/pgbouncer-userlist.sh
# DEV: defaults fracos = mesmos do deploy/init-dbs.sh (nunca usar em prod).
# PROD: .env.prod (gen-prod-env.sh) — o deploy gera antes do compose up.
# Idempotente. Nunca imprime senhas. userlist.txt é gitignored.
set -e
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
OUT="$ROOT/deploy/pgbouncer/userlist.txt"

u() { # u ROLE envvar default
  eval "v=\${$2:-$3}"
  printf '"%s" "%s"\n' "$1" "$v"
}

{
  u migrator MIGRATOR_PASSWORD dev_migrator_pw
  u app_auth APP_AUTH_PASSWORD dev_auth_pw
  u app_customers APP_CUSTOMERS_PASSWORD dev_customers_pw
  u app_products APP_PRODUCTS_PASSWORD dev_products_pw
  u app_access APP_ACCESS_PASSWORD dev_access_pw
  u app_licensing APP_LICENSING_PASSWORD dev_licensing_pw
  u app_billing APP_BILLING_PASSWORD dev_billing_pw
  u app_communications APP_COMMUNICATIONS_PASSWORD dev_comms_pw
  u app_finance APP_FINANCE_PASSWORD dev_finance_pw
  u app_finance_reports APP_FINANCE_REPORTS_PASSWORD dev_finrep_pw
  u app_audit_append APP_AUDIT_APPEND_PASSWORD dev_audit_append_pw
  u app_audit_read APP_AUDIT_READ_PASSWORD dev_audit_read_pw
} > "$OUT.tmp"
chmod 600 "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "pgbouncer userlist OK (12 roles, 0600, sem segredos no log)"
