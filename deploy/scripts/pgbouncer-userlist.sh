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

# Fonte das senhas (DEVE ser a mesma da interpolação do compose):
# - dev/CI: defaults fracos abaixo. O compose NÃO lê o .env da raiz p/
#   interpolar (project dir = deploy/); usa os defaults quando nada é
#   exportado — igual aqui. NUNCA ler .env aqui (TROCAR_* divergiria).
# - prod: exporte as MESMAS vars usadas no `compose --env-file` (ex.
#   `set -a; . /srv/aurum/.env.prod; set +a`), ou passe
#   ENV_FILE=/srv/aurum/.env.prod antes de rodar este script.
if [ -n "${ENV_FILE:-}" ] && [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ENV_FILE"
  set +a
fi

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
chmod 644 "$OUT.tmp"
# 644 (não 600): o PgBouncer roda como uid `postgres` na imagem oficial e precisa
# LER este arquivo — 600 o cega ("no such user" p/ todos). Segredo real nunca é
# commitado (.gitignore) e o diretório na VPS deve ser 700.
mv "$OUT.tmp" "$OUT"
echo "pgbouncer userlist OK (12 roles, 0644 p/ leitura pelo uid postgres, sem segredos no log)"
