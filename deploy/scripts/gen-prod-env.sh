#!/usr/bin/env bash
# deploy/scripts/gen-prod-env.sh — gera `.env.prod.new` com segredos aleatórios.
# Uso:
#   bash deploy/scripts/gen-prod-env.sh [--force] [--out <arquivo>]
#     --force        permite sobrescrever o arquivo de saída se ele já existir.
#     --out <arq>    caminho de saída (default: .env.prod.new, na raiz do repo).
# Comportamento:
#   - NUNCA sobrescreve `.env` existente (recusa sem --force p/ o alvo).
#   - Gera com `openssl rand -hex` (fallback: node crypto) e aplica `chmod 600`.
#   - NÃO imprime segredos no stdout (só o checklist pós-geração, sem valores).
#   - NÃO commita nada; o arquivo gerado está no `.gitignore`.
set -euo pipefail

FORCE=0
OUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --out) OUT="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Uso: bash deploy/scripts/gen-prod-env.sh [--force] [--out <arquivo>]"
      exit 0
      ;;
    *) echo "ERRO: argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

# Resolve a raiz do repo (este script vive em deploy/scripts/).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${OUT:-$ROOT/.env.prod.new}"

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

# Proteção extra: nunca mirar no `.env` de dev por acidente sem --force.
case "$(basename "$OUT")" in
  .env) echo "ERRO: recusando gerar diretamente sobre '.env' sem --force." >&2; exit 1 ;;
esac

PG_PASS="$(rand_b64 24)"        # 48 hex chars, URL-safe p/ DSNs
PG_USER="aurum"
INTERNAL_WEBHOOK_KEY="$(rand_hex 32)"     # 64 hex
INTERNAL_PROJECTION_KEY="$(rand_hex 32)"  # 64 hex
LICENSE_KEY_ENC_KEY="$(rand_hex 32)"      # 64 hex = AES-256
JWT_SECRET="$(rand_hex 32)"               # 64 hex (>= 16 chars exigidos)

umask 077
TMP="$(mktemp "${OUT}.tmp.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

cat > "$TMP" <<EOF
# .env.prod.new — GERADO em $(date -u +%Y-%m-%dT%H:%M:%SZ) por deploy/scripts/gen-prod-env.sh
# Segredos aleatórios gerados nesta máquina. COMPLETE os TROCAR_* no cofre
# (Asaas/Resend) antes de renomear para .env.prod. chmod 600 aplicado.
# NUNCA commitar. Cópia cifrada off-VPS obrigatória (ver docs/RUNBOOKS/env-prod.md).

NODE_ENV=production
PORT=3000
LOG_LEVEL=info

POSTGRES_USER=${PG_USER}
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=aurum

DATABASE_URL_AUTH=postgresql://${PG_USER}:${PG_PASS}@localhost:5432/auth?schema=public
DATABASE_URL_CUSTOMERS=postgresql://${PG_USER}:${PG_PASS}@localhost:5432/customers?schema=public
DATABASE_URL_PRODUCTS=postgresql://${PG_USER}:${PG_PASS}@localhost:5432/products?schema=public
DATABASE_URL_ACCESS=postgresql://${PG_USER}:${PG_PASS}@localhost:5432/access?schema=public
DATABASE_URL_LICENSING=postgresql://${PG_USER}:${PG_PASS}@localhost:5432/licensing?schema=public
DATABASE_URL_BILLING=postgresql://${PG_USER}:${PG_PASS}@localhost:5432/billing?schema=public
DATABASE_URL_FINANCE=postgresql://${PG_USER}:${PG_PASS}@localhost:5432/finance?schema=public
DATABASE_URL_AUDIT=postgresql://${PG_USER}:${PG_PASS}@localhost:5432/audit?schema=public
DATABASE_URL_COMMUNICATIONS=postgresql://${PG_USER}:${PG_PASS}@localhost:5432/communications?schema=public
DATABASE_URL=postgresql://${PG_USER}:${PG_PASS}@localhost:5432/auth?schema=public

REDIS_URL=redis://localhost:6379

JWT_SECRET=${JWT_SECRET}
JWT_ISS=aurum-bit
JWT_AUD=aurum-clients
JWT_TTL=15m

CORS_ORIGIN=https://aurumbit.com
CORS_ORIGINS=https://aurumbit.com

INTERNAL_WEBHOOK_KEY=${INTERNAL_WEBHOOK_KEY}
INTERNAL_PROJECTION_KEY=${INTERNAL_PROJECTION_KEY}

LICENSE_KEY_ENC_KEY=${LICENSE_KEY_ENC_KEY}

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

echo "OK: gerado '$OUT' (chmod 600). Nenhum segredo impresso acima — por design."
echo ""
echo "CHECKLIST PÓS-GERAÇÃO (obrigatório antes do primeiro boot prod):"
echo "  [ ] 1. Completar TROCAR_* (Asaas PROD + Resend PROD) via cofre — nunca em chat/log."
echo "  [ ] 2. CHECKPOINT DA CHAVE: incluir LICENSE_KEY_ENC_KEY no backup cifrado (T5)"
echo "         E guardar cópia cifrada OFF-VPS (ex. gpg -c + rclone) ANTES de emitir"
echo "         a primeira licença real. Perder a chave = licenças indecifráveis."
echo "  [ ] 3. Renomear para .env.prod (chmod 600 mantido) e NUNCA commitar."
echo "  [ ] 4. Confirmar ADMIN_DEV_OPEN ausente no arquivo final."
echo "  [ ] 5. Rebuild das imagens portal/admin APÓS fixar NEXT_PUBLIC_* (assam no build)."
echo "  [ ] 6. Boot: sem fail-fast; reveal deixa de dar 409; gitleaks limpo."
