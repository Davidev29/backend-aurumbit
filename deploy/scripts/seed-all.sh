#!/usr/bin/env bash
# deploy/scripts/seed-all.sh — Fase 1 (stub dev) + Fase 7 T3 (seed real).
#   SEED_MODE=prod  → seed-prod.sh (admin + catálogo, exige SEED_ADMIN_PASSWORD)
#   (default/dev)   → prisma/seed.ts legado (stub, nada persiste)
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TS_NODE_VERSION="${TS_NODE_VERSION:-10}"
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi
if [ "${SEED_MODE:-dev}" = "prod" ]; then
  echo "==> seed-all (SEED_MODE=prod → seed-prod.sh)"
  bash "$ROOT/deploy/scripts/seed-prod.sh"
  echo "seed-all OK (prod: admin + catálogo)"
  exit 0
fi
echo "==> seed-all (stub Fase 1)"
# Node 22.6+ executa .ts simples sem transpile (type stripping); fallback p/ ts-node.
if node "$ROOT/prisma/seed.ts"; then
  :
else
  npx -y "ts-node@${TS_NODE_VERSION}" --transpile-only "$ROOT/prisma/seed.ts"
fi
echo "seed-all OK (stub)"
