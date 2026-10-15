#!/bin/sh
# deploy/scripts/prisma-validate.sh — entrypoint ÚNICO de validação Prisma (Fase 9, ADR-006).
# Os 9 schemas estão declarados num só lugar (DOMAINS + prisma.config removido:
# Prisma 6.8 aceita apenas schema:string no config — 9 datasources independentes
# não fundem por conflito de blocos; ver .planning/PHASE-9-REPORT.md §desvios).
# Uso: bash deploy/scripts/prisma-validate.sh  (exit 0 = 9/9 válidos)
set -e
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
PRISMA_VERSION="${PRISMA_VERSION:-6.8.0}"
DOMAINS="auth customers products access licensing billing finance audit communications"

# validate não conecta no banco, mas exige as vars de datasource resolvidas.
# Em CI sem .env, injeta dummies (nunca segredos reais, nunca persistidos).
for d in $DOMAINS; do
  up="$(echo "$d" | tr 'abcdefghijklmnopqrstuvwxyz' 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"
  eval "v=\${DATABASE_URL_$up:-}"
  if [ -z "$v" ]; then
    export "DATABASE_URL_$up=postgresql://validate:validate@localhost:5432/aurumbit?schema=$d"
  fi
done

ok=0
cd "$ROOT" || exit 1
for d in $DOMAINS; do
  echo "== validate prisma/$d =="
  npx -y "prisma@${PRISMA_VERSION}" validate --schema="prisma/$d/schema.prisma"
  ok=$((ok + 1))
done
echo "prisma-validate OK ($ok dominios, single entrypoint)"
