#!/usr/bin/env bash
# deploy/scripts/migrate-diff-check.sh — Fase 7 T3. Anti-drift Prisma↔DB.
# Referenciado pelo CI (job prisma-validate-diff): valida os 9 schemas e, se
# houver DB ao alcance, confere que `migrate deploy --dry-run` não tem
# pendência (banco fora do schema = FAIL). Sem DB: valida schemas e sai 0
# com WARN (não falha o PR por falta de banco; o gate real roda no e2e).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOMAINS="auth customers products access licensing billing finance audit communications"
PRISMA_VERSION="${PRISMA_VERSION:-6}"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

for d in $DOMAINS; do
  echo "== validate prisma/$d =="
  npx -y "prisma@${PRISMA_VERSION}" validate --schema="$ROOT/prisma/$d/schema.prisma"
done

if ! command -v psql >/dev/null 2>&1; then
  echo "WARN: psql ausente — drift check contra DB pulado (schemas válidos, gate e2e cobre)."
  exit 0
fi
PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${POSTGRES_USER:-aurum}"
export PGPASSWORD="${POSTGRES_PASSWORD:-aurum}"
if ! pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
  echo "WARN: postgres inalcançável — drift check pulado (schemas válidos)."
  exit 0
fi
pending=0
for d in $DOMAINS; do
  out="$(npx -y "prisma@${PRISMA_VERSION}" migrate status --schema="$ROOT/prisma/$d/schema.prisma" 2>&1 || true)"
  echo "$out" | grep -qi "no pending\|up to date\|already in sync" \
    && echo "drift $d: none" \
    || { echo "drift $d: PENDENTE (ver output acima)"; pending=1; }
done
[ "$pending" = "0" ] || { echo "FAIL: migrations pendentes — rode migrate-all.sh" >&2; exit 1; }
echo "migrate-diff-check OK (9 schemas válidos, sem drift)"
