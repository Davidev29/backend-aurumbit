#!/usr/bin/env bash
# deploy/scripts/gen-prod-env.sh — gera `.env.prod.new` + master key de licenças.
# Uso:
#   bash deploy/scripts/gen-prod-env.sh [--force] [--out <arquivo>] [--key-out <arquivo>]
#     --force        permite sobrescrever os arquivos de saída se já existirem.
#     --out <arq>    caminho do env (default: .env.prod.new, na raiz do repo).
#     --key-out <aq> caminho da master key (default:
#                    deploy/secrets/license-master-key.new).
# Comportamento:
#   - NUNCA sobrescreve alvos existentes sem --force.
#   - Gera com `openssl rand -hex` (fallback: node crypto) e aplica `chmod 600`.
#   - NÃO imprime segredos no stdout (só o checklist pós-geração, sem valores).
#   - A master key vai p/ ARQUIVO 0600 separado (nunca como valor no .env):
#     o `.env` carrega só LICENSE_MASTER_KEY_PATH=/run/secrets/license-master-key.
#   - NÃO commita nada; os gerados estão no `.gitignore`.
set -euo pipefail

FORCE=0
OUT=""
KEY_OUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --key-out) KEY_OUT="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Uso: bash deploy/scripts/gen-prod-env.sh [--force] [--out <arquivo>] [--key-out <arquivo>]"
      exit 0
      ;;
    *) echo "ERRO: argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

# Resolve a raiz do repo (este script vive em deploy/scripts/).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${OUT:-$ROOT/.env.prod.new}"
KEY_OUT="${KEY_OUT:-$ROOT/deploy/secrets/license-master-key.new}"

rand_hex() {
  # $1 = nº de bytes (hex final = 2x). Gera sem expor valor em log.
  local n="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$n"
  else
    node -e "console.log(require('crypto').randomBytes($n).toString('hex'))"
  fi
}

rand_b64() {
  # $1 = nº de bytes. Para a senha do Postgres (caracteres URL-safe p/ DSN:
  # hex evita `@`, `/`, `+` que quebrariam as DATABASE_URL_*).
  local n="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$n"
  else
    node -e "console.log(require('crypto').randomBytes($n).toString('hex'))"
  fi
}

if [ -e "$OUT" ] && [ "$FORCE" -ne 1 ]; then
  echo "ERRO: '$OUT' já existe. Recusando sobrescrever sem --force." >&2
  echo "Dica: revise o arquivo existente ou apague-o conscientemente e rode de novo." >&2
  exit 1
fi

if [ -e "$KEY_OUT" ] && [ "$FORCE" -ne 1 ]; then
  echo "ERRO: '$KEY_OUT' já existe. Recusando sobrescrever sem --force." >&2
  exit 1
fi

# Proteção extra: nunca mirar no `.env` de dev por acidente sem --force.
case "$(basename "$OUT")" in
  .env) echo "ERRO: recusando gerar diretamente sobre '.env' sem --force." >&2; exit 1 ;;
esac

PG_PASS="$(rand_b64 24)"        # 48 hex chars, URL-safe p/ DSNs (superuser `aurum`)
PG_USER="aurum"
PG_DB="aurumbit"
# 1 senha por role (E2/E3: hex URL-safe — init-consolidated.sql + DSNs exigem).
MIGRATOR_PASSWORD="$(rand_b64 24)"
APP_AUTH_PASSWORD="$(rand_b64 24)"
APP_CUSTOMERS_PASSWORD="$(rand_b64 24)"
APP_PRODUCTS_PASSWORD="$(rand_b64 24)"
APP_ACCESS_PASSWORD="$(rand_b64 24)"
APP_LICENSING_PASSWORD="$(rand_b64 24)"
APP_BILLING_PASSWORD="$(rand_b64 24)"
APP_FINANCE_PASSWORD="$(rand_b64 24)"
APP_AUDIT_APPEND_PASSWORD="$(rand_b64 24)"
APP_COMMUNICATIONS_PASSWORD="$(rand_b64 24)"
APP_FINANCE_REPORTS_PASSWORD="$(rand_b64 24)"
APP_AUDIT_READ_PASSWORD="$(rand_b64 24)"
INTERNAL_WEBHOOK_KEY="$(rand_hex 32)"     # 64 hex
INTERNAL_PROJECTION_KEY="$(rand_hex 32)"  # 64 hex
JWT_SECRET="$(rand_hex 32)"               # 64 hex (>= 16 chars exigidos)

# Master key de licenças (AES-256): 64 hex SEM newline, só no arquivo 0600.
MASTER_KEY="$(rand_hex 32)"
mkdir -p "$(dirname "$KEY_OUT")"
umask 077
KEY_TMP="$(mktemp "${KEY_OUT}.tmp.XXXXXX")"
trap 'rm -f "$TMP" "$KEY_TMP"' EXIT
printf '%s' "$MASTER_KEY" > "$KEY_TMP"
mv "$KEY_TMP" "$KEY_OUT"
chmod 600 "$KEY_OUT"
MASTER_KEY=""  # limpa a variável; o valor jamais é impresso.

umask 077
TMP="$(mktemp "${OUT}.tmp.XXXXXX")"
trap 'rm -f "$TMP" "$KEY_TMP"' EXIT

cat > "$TMP" <<EOF
# .env.prod.new — GERADO em $(date -u +%Y-%m-%dT%H:%M:%SZ) por deploy/scripts/gen-prod-env.sh
# Banco consolidado 'aurumbit' (E2/E3): 1 senha por role + URLs por domínio.
# COMPLETE os TROCAR_* no cofre (Asaas/Resend) antes de renomear para .env.prod.
# chmod 600 aplicado. NUNCA commitar. Cópia cifrada off-VPS obrigatória
# (ver docs/RUNBOOKS/env-prod.md) — INCLUINDO a master key de licenças.

NODE_ENV=production
PORT=3000
LOG_LEVEL=info

POSTGRES_USER=${PG_USER}
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=${PG_DB}

MIGRATOR_PASSWORD=${MIGRATOR_PASSWORD}
APP_AUTH_PASSWORD=${APP_AUTH_PASSWORD}
APP_CUSTOMERS_PASSWORD=${APP_CUSTOMERS_PASSWORD}
APP_PRODUCTS_PASSWORD=${APP_PRODUCTS_PASSWORD}
APP_ACCESS_PASSWORD=${APP_ACCESS_PASSWORD}
APP_LICENSING_PASSWORD=${APP_LICENSING_PASSWORD}
APP_BILLING_PASSWORD=${APP_BILLING_PASSWORD}
APP_FINANCE_PASSWORD=${APP_FINANCE_PASSWORD}
APP_AUDIT_APPEND_PASSWORD=${APP_AUDIT_APPEND_PASSWORD}
APP_COMMUNICATIONS_PASSWORD=${APP_COMMUNICATIONS_PASSWORD}
APP_FINANCE_REPORTS_PASSWORD=${APP_FINANCE_REPORTS_PASSWORD}
APP_AUDIT_READ_PASSWORD=${APP_AUDIT_READ_PASSWORD}

DATABASE_URL_AUTH=postgresql://app_auth:${APP_AUTH_PASSWORD}@localhost:6432/aurumbit?schema=auth&pgbouncer=true&connection_limit=20
DATABASE_URL_CUSTOMERS=postgresql://app_customers:${APP_CUSTOMERS_PASSWORD}@localhost:6432/aurumbit?schema=customers&pgbouncer=true&connection_limit=15
DATABASE_URL_PRODUCTS=postgresql://app_products:${APP_PRODUCTS_PASSWORD}@localhost:6432/aurumbit?schema=products&pgbouncer=true&connection_limit=15
DATABASE_URL_ACCESS=postgresql://app_access:${APP_ACCESS_PASSWORD}@localhost:6432/aurumbit?schema=access&pgbouncer=true&connection_limit=20
DATABASE_URL_LICENSING=postgresql://app_licensing:${APP_LICENSING_PASSWORD}@localhost:5432/aurumbit?schema=licensing&connection_limit=20
DATABASE_URL_BILLING=postgresql://app_billing:${APP_BILLING_PASSWORD}@localhost:6432/aurumbit?schema=billing&pgbouncer=true&connection_limit=15
DATABASE_URL_FINANCE=postgresql://app_finance:${APP_FINANCE_PASSWORD}@localhost:6432/aurumbit?schema=finance&pgbouncer=true&connection_limit=10
DATABASE_URL_AUDIT=postgresql://app_audit_append:${APP_AUDIT_APPEND_PASSWORD}@localhost:6432/aurumbit?schema=audit&pgbouncer=true&connection_limit=10
DATABASE_URL_COMMUNICATIONS=postgresql://app_communications:${APP_COMMUNICATIONS_PASSWORD}@localhost:6432/aurumbit?schema=communications&pgbouncer=true&connection_limit=15
DATABASE_URL_FINANCE_REPORTS=postgresql://app_finance_reports:${APP_FINANCE_REPORTS_PASSWORD}@localhost:6432/aurumbit?schema=finance&pgbouncer=true&connection_limit=5
DATABASE_URL_AUDIT_READ=postgresql://app_audit_read:${APP_AUDIT_READ_PASSWORD}@localhost:6432/aurumbit?schema=audit&pgbouncer=true&connection_limit=5
MIGRATOR_DATABASE_URL=postgresql://migrator:${MIGRATOR_PASSWORD}@localhost:5432/aurumbit
DATABASE_URL=postgresql://app_auth:${APP_AUTH_PASSWORD}@localhost:6432/aurumbit?schema=auth&pgbouncer=true&connection_limit=20

REDIS_URL=redis://localhost:6379

JWT_SECRET=${JWT_SECRET}
JWT_ISS=aurum-bit
JWT_AUD=aurum-clients
JWT_TTL=15m

CORS_ORIGIN=https://aurumbit.com
CORS_ORIGINS=https://aurumbit.com

INTERNAL_WEBHOOK_KEY=${INTERNAL_WEBHOOK_KEY}
INTERNAL_PROJECTION_KEY=${INTERNAL_PROJECTION_KEY}

# Master key de licenças: SÓ o caminho (o valor está no arquivo 0600 gerado junto).
LICENSE_MASTER_KEY_PATH=/run/secrets/license-master-key
# LICENSE_MASTER_KEY_PREVIOUS_PATH=
# REMOVIDO (E8): LICENSE_KEY_ENC_KEY — não recriar.

ASAAS_API_URL=https://api.asaas.com/api/v3
ASAAS_API_KEY=TROCAR_ASAAS_API_KEY_PROD_DO_COFRE
ASAAS_WEBHOOK_SECRET=TROCAR_ASAAS_WEBHOOK_SECRET_PROD
# ASAAS_IP_ALLOWLIST=

RESEND_API_KEY=TROCAR_RESEND_API_KEY_PROD_DO_COFRE
RESEND_FROM=no-reply@aurumbit.com

NEXT_PUBLIC_API_URL=https://api.aurumbit.com
NEXT_PUBLIC_SITE_URL=https://aurumbit.com
API_INTERNAL_URL=http://api:3000
# ADMIN_DEV_OPEN: AUSENTE EM PROD — nunca adicionar (incidente se existir).

OTEL_SERVICE_NAME=aurum-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
EOF

mv "$TMP" "$OUT"
chmod 600 "$OUT"
trap - EXIT

echo "OK: gerado '$OUT' + master key '$KEY_OUT' (chmod 600). Nenhum segredo impresso acima — por design."
echo ""
echo "CHECKLIST PÓS-GERAÇÃO (obrigatório antes do primeiro boot prod):"
echo "  [ ] 1. Completar TROCAR_* (Asaas PROD + Resend PROD) via cofre — nunca em chat/log."
echo "  [ ] 2. CHECKPOINT DA CHAVE: incluir '$KEY_OUT' no backup cifrado (T5)"
echo "         E guardar cópia cifrada OFF-VPS (ex. gpg -c + rclone) ANTES de emitir"
echo "         a primeira licença real. Perder a master key = licenças indecifráveis."
echo "  [ ] 3. Renomear para .env.prod e a key .new p/ final (chmod 600 mantidos);"
echo "         NUNCA commitar. Materializar deploy/pgbouncer/userlist.txt com as"
echo "         MESMAS senhas: ENV_FILE=/srv/aurum/.env.prod bash deploy/scripts/pgbouncer-userlist.sh"
echo "         (o PgBouncer lê como uid postgres — o script já gera 0644)."
echo "  [ ] 4. Confirmar ADMIN_DEV_OPEN ausente no arquivo final."
echo "  [ ] 5. Rebuild das imagens portal/admin APÓS fixar NEXT_PUBLIC_* (assam no build)."
echo "  [ ] 6. Boot: sem fail-fast; reveal deixa de dar 409; gitleaks limpo."
