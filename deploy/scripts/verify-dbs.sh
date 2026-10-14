#!/usr/bin/env bash
# deploy/scripts/verify-dbs.sh — Fase 7 T3. Checagem 9 DBs + contagens âncora.
# Complementa o backup-check.sh (que dá o veredito pg+9): aqui, cada domínio
# informa a contagem da sua tabela âncora. FAIL (exit 1) se pg fora, DB
# ausente ou tabela âncora ilegível. Saída final: `done (ok: pg up + 9 DBs)`.
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${POSTGRES_USER:-aurum}"
export PGPASSWORD="${POSTGRES_PASSWORD:-aurum}"

# db:tabela-âncora (tabelas @@map reais dos schemas Prisma).
ANCHORS="auth:user_identities customers:customer_profiles products:products access:access_grants licensing:licenses billing:invoices finance:ledger_entries audit:audit_events communications:email_templates"

command -v psql >/dev/null 2>&1 || { echo "[verify-dbs] psql ausente — pule (CI usa container)" >&2; exit 0; }
command -v pg_isready >/dev/null 2>&1 && pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
  || { echo "[verify-dbs] FAIL: postgres inalcançável ($PGHOST:$PGPORT)" >&2; exit 1; }

n=0
for pair in $ANCHORS; do
  db="${pair%%:*}"; table="${pair##*:}"
  count="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM \"$table\";" 2>/dev/null)" \
    || { echo "[verify-dbs] FAIL: $db.$table ilegível (migrate pendente?)" >&2; exit 1; }
  echo "[verify-dbs] $db.$table=$count"
  n=$((n + 1))
done
[ "$n" = "9" ] || { echo "[verify-dbs] FAIL: $n/9 verificados" >&2; exit 1; }
echo "[verify-dbs] done (ok: pg up + 9 DBs)"
