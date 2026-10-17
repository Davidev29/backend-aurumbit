#!/usr/bin/env bash
set -e
# Cria nova migration em ambiente dev.
# Uso: ./migrate-new.sh <dominio> <nome_migration>
# Ex.: ./migrate-new.sh auth init
#
# Correcoes 2026-10-17 (FATALs "database ... does not exist" no postgres):
#  1) carrega o .env da raiz (igual ao migrate-all.sh). Sem isso o Prisma herda
#     variaveis velhas do shell (pre-consolidacao = 1 banco por dominio) e o
#     postgres loga `FATAL: database "<dominio>" does not exist`.
#  2) usa o role `migrator` (DDL) derivado de MIGRATOR_PASSWORD, igual ao
#     MIGRATE_AS_MIGRATOR=1 do migrate-all.sh (roles de app nao tem DDL).
#  3) passa --shadow-database-url: o role `migrator` nao tem CREATEDB, entao
#     sem um banco de sombra ja existente o Prisma falha com
#     `FATAL: database "aurumbit_shadow" does not exist`.
#     O banco `aurumbit_shadow` e criado pelo deploy/init-dbs.sh (dev).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOMAIN="${1:?informe o dominio: auth customers products access licensing billing finance audit communications}"
NAME="${2:-init}"

# Prisma pinnado (stable), igual ao migrate-all.sh.
PRISMA_VERSION="${PRISMA_VERSION:-6.8.0}"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

MIG_PW="${MIGRATOR_PASSWORD:-dev_migrator_pw}"
MIG_HOST="${MIGRATE_HOST:-localhost}"
MIG_PORT="${MIGRATE_PORT:-5432}"
UP="$(echo "$DOMAIN" | tr '[:lower:]' '[:upper:]')"

# Sobrescreve com o role de DDL (o .env traz roles de app, sem DDL).
export "DATABASE_URL_${UP}=postgresql://migrator:${MIG_PW}@${MIG_HOST}:${MIG_PORT}/aurumbit?schema=${DOMAIN}"
export "DATABASE_URL=postgresql://migrator:${MIG_PW}@${MIG_HOST}:${MIG_PORT}/aurumbit?schema=auth"

SHADOW_URL="${SHADOW_DATABASE_URL:-postgresql://migrator:${MIG_PW}@${MIG_HOST}:${MIG_PORT}/aurumbit_shadow}"

echo "==> migrate dev: $DOMAIN ($NAME)  [role migrator @ ${MIG_HOST}:${MIG_PORT}]"
npx -y "prisma@${PRISMA_VERSION}" migrate dev \
  --schema="$ROOT/prisma/$DOMAIN/schema.prisma" \
  --name="$NAME" \
  --shadow-database-url="$SHADOW_URL"
