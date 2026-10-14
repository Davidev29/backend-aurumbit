#!/usr/bin/env bash
set -e
# Aplica migrations pendentes nos 9 domínios, ordem fixa. Falha em qualquer passo aborta (set -e).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOMAINS="auth customers products access licensing billing finance audit communications"

# Prisma pinnado (stable): `npx` sem versão pode puxar RC/latest quebrada.
PRISMA_VERSION="${PRISMA_VERSION:-6}"

# Carrega DATABASE_URL_* do .env da raiz (bash não lê .env sozinho).
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

for d in $DOMAINS; do
  echo "==> migrate deploy: $d"
  npx -y "prisma@${PRISMA_VERSION}" migrate deploy --schema="$ROOT/prisma/$d/schema.prisma"
done

echo "migrate-all OK (9 dominios)"
