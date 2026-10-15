#!/usr/bin/env bash
# deploy/scripts/migrate-diff-check.sh — Fase 7 T3. Anti-drift Prisma↔DB.
# Referenciado pelo CI (job prisma-validate-diff): valida o schema ÚNICO e, se
# houver DB ao alcance, confere que `migrate status` não tem pendência por
# schema (DB único `aurumbit`, 9 schemas: auth … communications) + que os 9
# schemas existem em `information_schema.schemata`. Sem DB: valida o schema e
# sai 0 com WARN (não falha o PR por falta de banco; o gate real roda no e2e).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCHEMAS="auth customers products access licensing billing finance audit communications"
PRISMA_VERSION="${PRISMA_VERSION:-6.8.0}"
# Validação via entrypoint único (E1: declara os 9 schemas num só lugar).

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

echo "== validate (1 entrypoint, 9 schemas) =="
bash "$ROOT/deploy/scripts/prisma-validate.sh"

if ! command -v psql >/dev/null 2>&1; then
  echo "WARN: psql ausente — drift check contra DB pulado (schema válido, gate e2e cobre)."
  exit 0
fi
PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${POSTGRES_USER:-aurum}"
export PGPASSWORD="${POSTGRES_PASSWORD:-aurum}"
SINGLE_DB="${SINGLE_DB:-aurumbit}"
if ! pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
  echo "WARN: postgres inalcançável — drift check pulado (schema válido)."
  exit 0
fi

# Migrações correm com a URL do migrador (papel DDL); cai p/ DATABASE_URL.
MIG_URL="${MIGRATOR_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$MIG_URL" ]; then
  echo "WARN: MIGRATOR_DATABASE_URL/DATABASE_URL ausentes — migrate status pulado (só schemata)."
else
  for s in $SCHEMAS; do
    out="$(DATABASE_URL="$MIG_URL" npx -y "prisma@${PRISMA_VERSION}" migrate status --schema="$ROOT/prisma/$s/schema.prisma" 2>&1 || true)"
    echo "$out" | grep -qi "no pending\|up to date\|already in sync" \
      && echo "drift $s: none" \
      || { echo "drift $s: PENDENTE (ver output acima)" >&2; echo "$out" >&2; exit 1; }
  done
fi

missing="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SINGLE_DB" -tAc \
  "SELECT s FROM (VALUES ('auth'),('customers'),('products'),('access'),('licensing'),('billing'),('finance'),('audit'),('communications')) AS e(s) WHERE s NOT IN (SELECT schema_name FROM information_schema.schemata);" | tr '\n' ' ' | tr -s ' ')"
if [ -n "$missing" ]; then
  echo "FAIL: schemas ausentes em $SINGLE_DB:$missing" >&2
  exit 1
fi
echo "migrate-diff-check OK (9 schemas validos, 9 schemas presentes, sem drift)"
