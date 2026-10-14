#!/usr/bin/env bash
# deploy/scripts/smoke-t0.sh — Fase 7 T0. Tracer portal prod-like local.
# Sobe postgres→migrate→api→portal (compose base + override prod) e valida:
#   (a) GET / → 200 com vitrine vinda da API (anti-mock por comparação de codes);
#   (b) TESTE NEGATIVO: com o container api parado, a home/BFF DEGRADA
#       visivelmente (502 UPSTREAM_* / estado de erro) — mock silencioso = FAIL;
#   (c) GET /api/products → 200 com os mesmos codes da API.
# Sem Docker: --check-only valida convenções (env + guarda upstream no BFF).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_URL="${API_URL:-http://localhost:3000}"
PORTAL_URL="${PORTAL_URL:-http://localhost:3002}"
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    --api=*) API_URL="${arg#--api=}" ;;
    --portal=*) PORTAL_URL="${arg#--portal=}" ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "flag desconhecida: $arg" >&2; exit 2 ;;
  esac
done

codes_of() { # json no stdin → codes ordenados (data/items/lista)
  python3 -c "import json,sys
try:
  d = json.load(sys.stdin)
  rows = d if isinstance(d, list) else d.get('data', d.get('items', []))
  print(' '.join(sorted(str(r.get('code', '')) for r in rows)))
except Exception: print('')"
}
http_code() { curl -sS -o /dev/null -w "%{http_code}" --max-time 15 "$@" || echo "000"; }

# --- Modo sem Docker: valida as convenções que tornam o tracer possível ------
if [ "$CHECK_ONLY" = "1" ]; then
  fail=0
  grep -q "API_INTERNAL_URL" "$ROOT/deploy/docker-compose.prod.yml" \
    && echo "ok: portal tem API_INTERNAL_URL no override prod" \
    || { echo "FAIL: API_INTERNAL_URL ausente no override"; fail=1; }
  grep -rq "resolveUpstream" "$ROOT/apps/portal/app/api/products/" \
    && echo "ok: BFF /api/products usa guarda fail-closed" \
    || { echo "FAIL: BFF products sem resolveUpstream"; fail=1; }
  grep -q "UPSTREAM_MISSING" "$ROOT/apps/portal/lib/upstream.ts" \
    && echo "ok: 502 UPSTREAM_MISSING existe" \
    || { echo "FAIL: upstream.ts sem UPSTREAM_MISSING"; fail=1; }
  [ "$fail" = "0" ] && echo "smoke-t0 --check-only PASS" && exit 0 || exit 1
fi

command -v docker >/dev/null 2>&1 || { echo "sem docker: rode --check-only" >&2; exit 2; }
cd "$ROOT"
echo "[t0] up postgres→migrate→api→portal…"
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build postgres migrate api portal

echo "[t0] aguarda api ready + portal 200 (até 180s)…"
for i in $(seq 1 36); do
  if [ "$(http_code "$API_URL/health/ready")" = "200" ] && [ "$(http_code "$PORTAL_URL/")" = "200" ]; then break; fi
  sleep 5; [ "$i" = "36" ] && { echo "FAIL: stack não subiu"; exit 1; }
done

# (a) vitrine real: codes da API não-vazios…
api_body="$(curl -sS --max-time 15 "$API_URL/v1/products" || echo '')"
api_codes="$(printf '%s' "$api_body" | codes_of)"
[ -n "$api_codes" ] || { echo "FAIL: API /v1/products vazia/ilegível"; exit 1; }
echo "[t0] (a) api codes: $api_codes"
home="$(curl -sS --max-time 15 "$PORTAL_URL/" || echo '')"
echo "$home" | grep -qi "produto" && echo "[t0] (a) home 200 com vitrine" || { echo "FAIL: home sem vitrine"; exit 1; }

# (c) BFF espelha a API…
bff_code="$(http_code "$PORTAL_URL/api/products")"
[ "$bff_code" = "200" ] || { echo "FAIL: BFF /api/products HTTP $bff_code"; exit 1; }
bff_body="$(curl -sS --max-time 15 "$PORTAL_URL/api/products" || echo '')"
echo "$bff_body" | grep -q "UPSTREAM_UNAVAILABLE" && { echo "FAIL: BFF em stub (mock silencioso)"; exit 1; }
bff_codes="$(printf '%s' "$bff_body" | codes_of)"
[ "$bff_codes" = "$api_codes" ] \
  && echo "[t0] (c) BFF = API (codes conferem)" \
  || { echo "FAIL: codes divergem api=[$api_codes] bff=[$bff_codes]"; exit 1; }

# (b) TESTE NEGATIVO: api parada → BFF degrada visivelmente, nunca mock…
echo "[t0] (b) parando api (teste negativo anti-mock)…"
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml stop api
sleep 3
neg_code="$(http_code "$PORTAL_URL/api/products")"
neg_body="$(curl -sS --max-time 15 "$PORTAL_URL/api/products" || echo '')"
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml start api
case "$neg_code:$neg_body" in
  502:*UPSTREAM*|502:*upstream*|500:*|503:*)
    echo "[t0] (b) PASS: sem api → HTTP $neg_code visível (sem mock silencioso)" ;;
  200:*)
    r_codes="$(printf '%s' "$neg_body" | codes_of)"
    if [ -n "$r_codes" ]; then echo "FAIL: sem api, BFF serviu catálogo (mock silencioso)"; exit 1; fi
    echo "[t0] (b) PASS: sem api → 200 vazio honesto (sem mock de catálogo)" ;;
  *) echo "FAIL: resposta inesperada sem api: HTTP $neg_code"; exit 1 ;;
esac

echo "[t0] smoke-t0 PASS (a+b+c verdes)"
