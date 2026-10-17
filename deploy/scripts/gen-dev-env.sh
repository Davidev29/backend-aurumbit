#!/usr/bin/env bash
# deploy/scripts/gen-dev-env.sh — completo o `.env` de DEV/CI com segredos reais.
#
# Por que existe (T0-8 do CORRECTION-PLAN-02): o `env.schema.ts` (D2-4) rejeita
# placeholders em QUALQUER ambiente (`^trocar`, `change-me`, ...). O fluxo
# documentado — `cp .env.example .env` + `docker compose up` — passou a deixar a
# API em crash-loop (`Env inválida (fail-fast): JWT_SECRET ... MFA_ENC_KEY ...`),
# e era exatamente isso que quebrava o job `e2e-compose-efemero` do CI desde o
# fix D2-4: o compose sobe, o `/health/ready` nunca fica ok.
#
# Uso:
#   bash deploy/scripts/gen-dev-env.sh [--env-file <arquivo>]
#     --env-file <arq>  env a completar (default: .env na raiz do repo)
#
# Comportamento:
#   - Preenche SÓ o que o fail-fast rejeita: JWT_SECRET e MFA_ENC_KEY.
#   - IDEMPOTENTE: valor que não é placeholder é preservado (o `.env` de dev
#     com segredo real não é tocado).
#   - `AUTH_JWT_SECRET` real tem PRECEDÊNCIA: se existir, JWT_SECRET espelha o
#     mesmo valor (o schema aborta o boot quando os dois divergem — ver
#     `env.schema.ts` superRefine).
#   - Nunca imprime valor de segredo (só o que foi gerado/mantido).
#   - NÃO commita nada; `.env` é gitignored.
set -euo pipefail

ENV_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Uso: bash deploy/scripts/gen-dev-env.sh [--env-file <arquivo>]"
      exit 0
      ;;
    *) echo "ERRO: argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

# Resolve a raiz do repo (este script vive em deploy/scripts/).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERRO: '$ENV_FILE' não existe." >&2
  echo "Dica: rode antes \`cp .env.example .env\` (e nunca versione o .env)." >&2
  exit 1
fi

rand_hex() {
  # $1 = nº de bytes (hex final = 2x). Mesmo idioma de gen-prod-env.sh.
  local n="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$n"
  else
    node -e "console.log(require('crypto').randomBytes($n).toString('hex'))"
  fi
}

is_placeholder() {
  # Mesmas famílias de placeholder do SECRET_PLACEHOLDERS (env.schema.ts),
  # comparando em minúsculas. "vazio" também conta como placeholder.
  local s
  s="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$s" in
    ""|trocar*|change-me*|change_me*|changeme*|placeholder*|replace-me*|replace_me*|replaceme*) return 0 ;;
    gerar-*|gerar_*|gerar*) return 0 ;;
    example*|seu-segredo*|seu_segredo*|xxx*|dev-only-insecure-secret) return 0 ;;
    '${'*'}'|'<'*'>') return 0 ;;
  esac
  return 1
}

read_value() {
  # Última ocorrência de `KEY=` no arquivo (o schema/`ConfigModule` usam a última).
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

write_value() {
  # Substitui a linha `KEY=` (ou anexa, se ausente) SEM expor o valor.
  local key="$1" value="$2" tmp
  if grep -q "^${key}=" "$ENV_FILE"; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" -F= '
      $0 ~ "^"k"=" { print k"="v; next }
      { print }
    ' "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

ACTION_JWT="mantido (valor existente não é placeholder)"
ACTION_MFA="mantido (valor existente não é placeholder)"

# JWT_SECRET: AUTH_JWT_SECRET (quando real) tem precedência — espelhar evita o
# boot abortar por divergência. Senão, gera 32 bytes (64 hex).
auth_jwt="$(read_value AUTH_JWT_SECRET || true)"
jwt="$(read_value JWT_SECRET || true)"
if [ -n "$auth_jwt" ] && ! is_placeholder "$auth_jwt"; then
  if [ "$jwt" != "$auth_jwt" ]; then
    write_value JWT_SECRET "$auth_jwt"
    ACTION_JWT="espelha AUTH_JWT_SECRET (precedência — valores divergentes abortam o boot)"
  fi
elif is_placeholder "$jwt"; then
  write_value JWT_SECRET "$(rand_hex 32)"
  ACTION_JWT="gerado (32 bytes, valor oculto)"
fi

# MFA_ENC_KEY: chave dedicada do segredo TOTP (D2-3) — 32 bytes.
mfa="$(read_value MFA_ENC_KEY || true)"
if is_placeholder "$mfa"; then
  write_value MFA_ENC_KEY "$(rand_hex 32)"
  ACTION_MFA="gerado (32 bytes, valor oculto)"
fi

echo "gen-dev-env: '$ENV_FILE' completo (fail-fast D2-4: placeholders reprovam)."
echo "  JWT_SECRET   : $ACTION_JWT"
echo "  MFA_ENC_KEY  : $ACTION_MFA"
echo "Nenhum valor foi impresso. O arquivo é local (gitignored) — nunca versione."
