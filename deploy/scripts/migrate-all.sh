#!/usr/bin/env bash
set -e
# Aplica migrations pendentes nos 9 domínios, ordem fixa. Falha em qualquer passo aborta (set -e).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOMAINS="auth customers products access licensing billing finance audit communications"

# Prisma pinnado (stable): `npx` sem versão pode puxar RC/latest quebrada.
PRISMA_VERSION="${PRISMA_VERSION:-6.8.0}"

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

# GRANT-REPAIR (Fase 9, ADR-006): migrate cria tabelas como migrator.
# DEFAULT PRIVILEGES cobrem o futuro; tabelas desta passada precisam do GRANT.
# Idempotente via deploy/grant-repair.sql; nunca falha o deploy.
MIG_URL="${MIGRATOR_DATABASE_URL:-}"
if [ -n "$MIG_URL" ] && command -v psql >/dev/null 2>&1; then
  echo "==> grant-repair (DML por schema)"
  psql "$MIG_URL" -v ON_ERROR_STOP=1 -f "$ROOT/deploy/grant-repair.sql" \
    || echo "WARN: grant-repair falhou - rode deploy/grant-repair.sql manualmente."
else
  echo "WARN: MIGRATOR_DATABASE_URL/psql ausentes - grant-repair pulado."
fi

echo "migrate-all OK (9 dominios)"

# Safety E6 (Fase 9): garante a partição do mês seguinte de
# audit.audit_events + audit.security_events (idempotente). Nunca falha o
# deploy: migrations são a fonte da verdade; aqui é só cinto + suspensórios.
"$ROOT/deploy/scripts/audit-partition.sh" \
  || echo "WARN: audit-partition falhou (ver logs) — migrations aplicadas; rode o script manualmente."
