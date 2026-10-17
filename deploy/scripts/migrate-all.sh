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

# DEV com .env least-privilege: as DATABASE_URL_* do .env usam roles de app
# (sem DDL) — migrate direto com elas morre em `permission denied`.
# Com MIGRATE_AS_MIGRATOR=1, deriva URLs do role `migrator` (DDL) a partir de
# MIGRATOR_PASSWORD. Host/porta via MIGRATE_HOST/MIGRATE_PORT (default:
# localhost:5432 = ferramentas do HOST; dentro do compose o serviço `migrate`
# já recebe URLs prontas e NÃO precisa desta flag).
# start-backend.ps1 exporta MIGRATE_AS_MIGRATOR=1 automaticamente no DEV.
if [ "${MIGRATE_AS_MIGRATOR:-0}" = "1" ]; then
  MIG_PW="${MIGRATOR_PASSWORD:-dev_migrator_pw}"
  MIG_HOST="${MIGRATE_HOST:-localhost}"
  MIG_PORT="${MIGRATE_PORT:-5432}"
  for d in $DOMAINS; do
    # export explícito: sem ele o npx/prisma (processo filho) não enxerga a
    # derivação e cai nos valores do .env (roles de app, sem DDL).
    u=$(echo "$d" | tr '[:lower:]' '[:upper:]')
    export "DATABASE_URL_${u}=postgresql://migrator:${MIG_PW}@${MIG_HOST}:${MIG_PORT}/aurumbit?schema=${d}"
  done
  export "DATABASE_URL=postgresql://migrator:${MIG_PW}@${MIG_HOST}:${MIG_PORT}/aurumbit?schema=auth"
  export "MIGRATOR_DATABASE_URL=postgresql://migrator:${MIG_PW}@${MIG_HOST}:${MIG_PORT}/aurumbit"
  echo "migrate-all: usando role migrator (${MIG_HOST}:${MIG_PORT}) via MIGRATE_AS_MIGRATOR=1"
fi

# BASELINE DO AUDIT (E6): o init-consolidated.sql (§6) pré-cria as tabelas
# particionadas (fonte única compartilhada com as migrations 0001/0002, tudo
# IF NOT EXISTS). Num banco novo, o `deploy` do audit morreria com P3005
# (schema não vazio sem histórico). Marca 0001 como aplicada SOMENTE quando
# ainda não há registro — idempotente: primeira passada registra ("marked as
# applied"), repetições caem no P3008 ("already recorded as applied") e seguem.
#
# SAFETY: marcar 0001 sem a tabela `audit.audit_events` existir produz um
# `migrate status` verde sobre um schema INCOMPLETO — se o init-consolidated.sql
# falhou, a tabela nunca é criada e o runtime quebra depois com
# `relation "audit_events" does not exist` sem nenhum erro no deploy. Só marca
# quando a baseline realmente criou a tabela; caso contrário, ABORTA.
MIG_URL_BASELINE="${MIGRATOR_DATABASE_URL:-}"
audit_events_exists() { # 0=existe 1=ausente 2=não verificável
  local q="SELECT to_regclass('audit.audit_events') IS NOT NULL"
  local out
  if [ -n "$MIG_URL_BASELINE" ] && command -v psql >/dev/null 2>&1; then
    out="$(psql -tAX -v ON_ERROR_STOP=1 "$MIG_URL_BASELINE" -c "$q" 2>/dev/null)" || return 2
  elif [ -n "$MIG_URL_BASELINE" ] && command -v docker >/dev/null 2>&1; then
    # Sem `psql` no PATH (ex.: Windows dev), vai pelo container do Postgres.
    out="$(printf '%s\n' "$q" | docker exec -i \
      -e PGPASSWORD="${MIGRATOR_PASSWORD:-dev_migrator_pw}" "${PG_CONTAINER:-aurum-postgres}" \
      psql -tAX -v ON_ERROR_STOP=1 -U migrator -d aurumbit 2>/dev/null)" || return 2
  else
    return 2
  fi
  [ "$out" = "t" ] && return 0
  [ "$out" = "f" ] && return 1
  return 2
}

echo "==> audit baseline (0001_baseline)"
audit_rc=0
audit_events_exists || audit_rc=$?
if [ "$audit_rc" -ne 0 ]; then
  if [ "$audit_rc" -eq 1 ]; then
    echo "ERRO: a tabela audit.audit_events NAO existe — init-consolidated.sql (§6) falhou ou nao rodou." >&2
    echo "      Marcar 0001 como applied agora deixaria 'migrate status' verde sobre um schema incompleto" >&2
    echo "      e o runtime quebraria com 'relation \"audit_events\" does not exist' SEM erro no deploy." >&2
  else
    echo "ERRO: nao foi possivel verificar a existencia de audit.audit_events (MIGRATOR_DATABASE_URL/psql/docker)." >&2
    echo "      Recusando marcar 0001 como applied sem prova de que a baseline rodou." >&2
  fi
  echo "      Rode o init-consolidated.sql (§6) com o role migrator e so entao reexecute o deploy." >&2
  exit 1
fi
AUDIT_BASE="$(npx -y "prisma@${PRISMA_VERSION}" migrate resolve --applied 0001_baseline --schema="$ROOT/prisma/audit/schema.prisma" 2>&1)" || true
echo "$AUDIT_BASE" | tail -n 2
case "$AUDIT_BASE" in
  *"marked as applied"*|*"already recorded as applied"*) ;;
  *) echo "ERRO: baseline do audit falhou (ver saída acima)" >&2; exit 1 ;;
esac

for d in $DOMAINS; do
  echo "==> migrate deploy: $d"
  npx -y "prisma@${PRISMA_VERSION}" migrate deploy --schema="$ROOT/prisma/$d/schema.prisma"
done

# GRANT-REPAIR (Fase 9, ADR-006): migrate cria tabelas como migrator.
# DEFAULT PRIVILEGES cobrem o futuro; tabelas desta passada precisam do GRANT.
# Idempotente via deploy/grant-repair.sql; nunca falha o deploy.
# Sem `psql` no PATH (ex.: Windows dev), usa o container do Postgres via
# `docker exec` (container_name fixo `aurum-postgres`, salvo PG_CONTAINER).
MIG_URL="${MIGRATOR_DATABASE_URL:-}"
if [ -n "$MIG_URL" ] && command -v psql >/dev/null 2>&1; then
  echo "==> grant-repair (DML por schema)"
  psql "$MIG_URL" -v ON_ERROR_STOP=1 -f "$ROOT/deploy/grant-repair.sql" \
    || echo "WARN: grant-repair falhou - rode deploy/grant-repair.sql manualmente."
elif [ -n "$MIG_URL" ] && command -v docker >/dev/null 2>&1; then
  echo "==> grant-repair via docker exec (sem psql local)"
  PG_CONTAINER="${PG_CONTAINER:-aurum-postgres}"
  MIG_PW_EXEC="${MIGRATOR_PASSWORD:-dev_migrator_pw}"
  docker exec -i -e PGPASSWORD="$MIG_PW_EXEC" "$PG_CONTAINER" \
    psql -U migrator -d aurumbit -v ON_ERROR_STOP=1 \
    < "$ROOT/deploy/grant-repair.sql" \
    || echo "WARN: grant-repair via docker falhou - rode deploy/grant-repair.sql manualmente."
else
  echo "WARN: MIGRATOR_DATABASE_URL/psql/docker ausentes - grant-repair pulado."
fi

echo "migrate-all OK (9 dominios)"

# Safety E6 (Fase 9): garante a partição do mês seguinte de
# audit.audit_events + audit.security_events (idempotente). Nunca falha o
# deploy: migrations são a fonte da verdade; aqui é só cinto + suspensórios.
"$ROOT/deploy/scripts/audit-partition.sh" \
  || echo "WARN: audit-partition falhou (ver logs) — migrations aplicadas; rode o script manualmente."
