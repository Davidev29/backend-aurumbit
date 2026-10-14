#!/usr/bin/env bash
# deploy/scripts/pre-dns-check.sh — Fase 7 T4. Gate PRÉ-corte de DNS.
# Valida a stack NA VPS sem depender de DNS (curl --resolve), ANTES de trocar
# qualquer registro. DNS é o ÚLTIMO passo, não o primeiro (§5 T4 + §6).
# Pré-requisitos do corte: (a) TTL 300 há 24–48h; (b) SPF/DKIM/DMARC Resend;
# (c) `curl --resolve` verde nos 3 hosts + HSTS + www→apex.
# Uso (na VPS): VPS_IP=<ip> bash deploy/scripts/pre-dns-check.sh [--resolve]
#   --resolve  consulta DNS público p/ TTL/TXT (fora da VPS, c/ DNS real).
#   (default)  valida via --resolve contra VPS_IP (sem tocar no DNS).
set -euo pipefail

VPS_IP="${VPS_IP:-}"
MODE="pin"
for arg in "$@"; do
  case "$arg" in
    --resolve) MODE="resolve" ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "flag desconhecida: $arg" >&2; exit 2 ;;
  esac
done

pass=0; fail=0
ok() { pass=$((pass + 1)); echo "ok: $1"; }
bad() { fail=$((fail + 1)); echo "FAIL: $1${2:+ — $2}"; }
http_code_resolve() { # host path — via VPS_IP sem DNS
  curl -sS -o /dev/null -w "%{http_code}" --max-time 15 \
    --resolve "$1:443:$VPS_IP" "https://$1$2" || echo "000"
}

if [ "$MODE" = "pin" ]; then
  [ -n "$VPS_IP" ] || { echo "VPS_IP obrigatório no modo pin (ex.: VPS_IP=203.0.113.10 $0)" >&2; exit 2; }
  for h in aurumbit.com admin.aurumbit.com api.aurumbit.com; do
    code="$(http_code_resolve "$h" "/")"
    [ "$code" = "200" ] && ok "$h / → 200 via --resolve $VPS_IP" || bad "$h / via --resolve" "HTTP $code"
  done
  code="$(http_code_resolve api.aurumbit.com /health/live)"
  [ "$code" = "200" ] && ok "api /health/live → 200" || bad "api /health/live" "HTTP $code"
  hsts="$(curl -sSI --max-time 15 --resolve "aurumbit.com:443:$VPS_IP" https://aurumbit.com/ | grep -i "strict-transport-security" || true)"
  [ -n "$hsts" ] && ok "HSTS presente no apex" || bad "HSTS" "header ausente"
  loc="$(curl -sSI --max-time 15 --resolve "www.aurumbit.com:443:$VPS_IP" https://www.aurumbit.com/ | grep -i "^location:" || true)"
  case "$loc" in *aurumbit.com*) ok "www → apex ($loc)" ;; *) bad "www → apex" "Location: ${loc:-ausente}" ;; esac
  echo "--- pin: pass=$pass fail=$fail ---"
  [ "$fail" = "0" ] && echo "pre-dns-check PIN PASS (stack pronta; DNS pode ser o último passo)" && exit 0
  echo "pre-dns-check PIN FAIL (não corte o DNS)" >&2; exit 1
fi

# --- Modo --resolve: DNS público (TTL 300 + TXT de e-mail) -------------------
command -v dig >/dev/null 2>&1 || { echo "dig ausente (instale dnsutils/bind-tools)" >&2; exit 2; }
ttl="$(dig +nocmd +noall +answer aurumbit.com | awk '{print $2}' | head -1)"
[ "${ttl:-9999}" -le 300 ] 2>/dev/null && ok "TTL apex = ${ttl}s (rollback rápido)" || bad "TTL apex" "${ttl:-?}s (baixar p/ 300 24–48h antes)"
for txt in "aurumbit.com:spf1" "resend._domainkey.aurumbit.com:DKIM" "_dmarc.aurumbit.com:DMARC"; do
  host="${txt%%:*}"; want="${txt##*:}"
  dig +short TXT "$host" | grep -qi "v=spf1\|v=DKIM1\|v=DMARC1" \
    && ok "TXT $host presente" \
    || bad "TXT $host ($want)" "ausente — transacional não sai sem ele"
done
echo "--- resolve: pass=$pass fail=$fail ---"
[ "$fail" = "0" ] && echo "pre-dns-check RESOLVE PASS" && exit 0
echo "pre-dns-check RESOLVE FAIL" >&2; exit 1
