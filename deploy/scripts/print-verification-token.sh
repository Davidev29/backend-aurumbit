#!/usr/bin/env bash
# deploy/scripts/print-verification-token.sh — DEV-ONLY.
#
# O e-mail de confirmação do cadastro (template `verify-email`) ainda NÃO tem
# consumidor em runtime: o token opaco de uso único vive apenas no outbox
# (`auth.outbox_events.payload->>'verificationToken'`). Este helper imprime o
# link pronto para concluir o fluxo cadastro → verificação no stack Docker de
# desenvolvimento. Em ambiente com o pipeline de e-mails ligado, NÃO use isto.
#
# Uso: bash deploy/scripts/print-verification-token.sh
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

CONTAINER="${PG_CONTAINER:-aurum-postgres}"
DB_USER="${POSTGRES_USER:-aurum}"
DB_NAME="${POSTGRES_DB:-aurumbit}"
PORTAL_URL="${PORTAL_URL:-http://localhost:3002}"

# Sempre o MAIS RECENTE (cadastro ou resend — ambos emitem o mesmo tipo).
SQL="SELECT payload->>'verificationToken' FROM auth.outbox_events
     WHERE payload ? 'verificationToken'
     ORDER BY \"createdAt\" DESC LIMIT 1;"
TOKEN="$(docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "$SQL" | tr -d '\r\n')"

if [ -z "$TOKEN" ]; then
  echo "Nenhum token de verificação no outbox — cadastre-se pelo portal primeiro." >&2
  exit 1
fi

echo "$PORTAL_URL/verificar-email?token=$TOKEN"
