#!/bin/sh
# deploy/scripts/pgbouncer-forupdate-check.sh — risco h1 (Fase 9 E3, ADR-006).
# Valida que transações curtas do licensing funcionam através do PgBouncer
# (pool_mode transaction). Abre 20 conexões concorrentes, cada uma com
# BEGIN + SELECT ... FOR UPDATE (mesmo padrão de devices.service link) +
# COMMIT, e falha se o pooler rejeitar ("cannot use ...", prepared inexistente...).
# Uso (stack no ar): APP_LICENSING_URL='postgresql://app_licensing:...@localhost:6432/aurumbit?schema=licensing'
#   bash deploy/scripts/pgbouncer-forupdate-check.sh
# Chamado pelo clone-ready-timer (gate nightly/manual, com stack completa).
# Sem URL, sem node ou com bypass direto (licensing→postgres:5432): SKIP, nunca FAIL.
set -e
URL="${APP_LICENSING_URL:-${DATABASE_URL_LICENSING:-}}"
if [ -z "$URL" ]; then echo "SKIP: APP_LICENSING_URL/DATABASE_URL_LICENSING ausentes"; exit 0; fi
if ! command -v node >/dev/null 2>&1; then echo "SKIP: node ausente"; exit 0; fi
case "$URL" in
  *@postgres:5432/*) echo "SKIP: licensing com bypass direto (sem pooler) — nada a validar"; exit 0;;
esac
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
if [ ! -d "$ROOT/node_modules/pg" ] && [ ! -d "$ROOT/apps/api/node_modules/pg" ]; then
  echo "SKIP: driver pg indisponivel"; exit 0
fi
export PGROOT="$ROOT" TARGET_URL="$URL"
node "$ROOT/deploy/scripts/pgbouncer-forupdate-check.cjs"
