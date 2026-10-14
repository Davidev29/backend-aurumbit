#!/usr/bin/env bash
set -e
# Cria nova migration em ambiente dev. Uso: ./migrate-new.sh <dominio> <nome_migration>
# Ex.: ./migrate-new.sh auth init
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOMAIN="${1:?informe o dominio: auth customers products access licensing billing finance audit communications}"
NAME="${2:-init}"

echo "==> migrate dev: $DOMAIN ($NAME)"
npx prisma migrate dev --schema="$ROOT/prisma/$DOMAIN/schema.prisma" --name="$NAME"
