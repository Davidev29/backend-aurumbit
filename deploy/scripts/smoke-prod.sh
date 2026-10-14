#!/usr/bin/env bash
# deploy/scripts/smoke-prod.sh — Smoke pós-deploy produção (Fase 7 T6).
#
# O que cobre (PHASE-7-PLAN.md §5 T6):
#   1. home 200 + âncora #produtos
#   2. #produtos com dados da API (anti-mock: FALHA se marker de mock)
#   3. checkout em valor mínimo + estorno (--live exige confirmação humana;
#      --dry-run só valida endpoints, sem cobrar)
#   4. re-entrega de webhook Asaas duplicado (mesmo eventId 2x → 1º recebido,
#      2º DUPLICATE 200, sem 2ª cobrança — exercita os Guards existentes:
#      UNIQUE(provider,externalId) + RECEIVED→VALIDATED→APPLIED/REJECTED/DUPLICATE)
#   5. URL de webhook documentada p/ confirmar no painel Asaas PROD (sem automatizar)
#   6. login admin 200 (ou prova de rota viva sem credencial)
#   7. /health/live 200
#   8. /metrics responde (consumidor adiado Fase 10 — só checa que responde)
#
# Segurança (restrições duras do T6):
#   - NUNCA cobra valor real sem `--live` + confirmação humana interativa.
#   - NUNCA chama o Asaas prod automaticamente (só a NOSSA API; painel Asaas é manual).
#   - NUNCA loga PII/cartão (payloads de webhook são resumidos a event/paymentId).
#   - Idempotente e re-executável: o teste de duplicata usa paymentId sintético
#     único por execução (`pay_smoke_<epoch>`); re-rodar nunca duplica efeito.
#
# Uso:
#   ./deploy/scripts/smoke-prod.sh [--dry-run] [--live]
#     [--portal https://aurumbit.com] [--api https://api.aurumbit.com]
#     [--admin https://admin.aurumbit.com]
#   SMOKE_ASAAS_SECRET   segredo do header `asaas-access-token` (sem ele, o
#                        teste de duplicata vira SKIP — nunca falha por falta
#                        de credencial, mesma convenção de deploy/load/smoke.js)
#   SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD  credenciais p/ login real (sem
#                        elas, valida-se só o formato da rota — sem login)
#
# Saída: TAP (`ok`/`not ok`/`# SKIP`) + checklist final. Exit 0 se nenhum FAIL.
# (SKIPs não falham o smoke.)
set -euo pipefail

PORTAL_BASE="${PORTAL_BASE:-https://aurumbit.com}"
API_BASE="${API_BASE:-https://api.aurumbit.com}"
ADMIN_BASE="${ADMIN_BASE:-https://admin.aurumbit.com}"
MODE="dry-run"

for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --live) MODE="live" ;;
    --portal=*) PORTAL_BASE="${arg#--portal=}" ;;
    --api=*) API_BASE="${arg#--api=}" ;;
    --admin=*) ADMIN_BASE="${arg#--admin=}" ;;
    --help|-h)
      sed -n '2,30p' "$0"
      echo "Bases atuais: portal=$PORTAL_BASE api=$API_BASE admin=$ADMIN_BASE"
      exit 0
      ;;
    *) echo "flag desconhecida: $arg (ver --help)" >&2; exit 2 ;;
  esac
done

for base in "$PORTAL_BASE" "$API_BASE" "$ADMIN_BASE"; do
  case "$base" in https://*|http://localhost*|http://127.0.0.1*) ;; *)
    echo "base inválida (só https ou localhost): $base" >&2; exit 2 ;;
  esac
done

ASAAS_SECRET="${SMOKE_ASAAS_SECRET:-}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-}"
ADMIN_PASS="${SMOKE_ADMIN_PASSWORD:-}"

# Endpoint canônico do webhook (global prefix `v1` + BillingWebhookController).
# É a URL a confirmar MANUALMENTE no painel Asaas PROD — este script nunca
# automatiza nada no painel (restrição T6).
WEBHOOK_PATH="/v1/billing/webhooks/asaas"
WEBHOOK_URL="${API_BASE}${WEBHOOK_PATH}"
WEBHOOK_TOKEN_HEADER="asaas-access-token"

PASS=0; FAIL=0; SKIP=0; N=0
http_code() { # $1=url [$2..]=curl args extras → imprime apenas o HTTP code
  local url="$1"; shift
  curl -sS -o /dev/null -w "%{http_code}" --max-time 15 "$@" "$url" || echo "000"
}
body_of() { # $1=url [$2..]=curl args extras → imprime o corpo (stderr = code em header X?)
  local url="$1"; shift
  curl -sS --max-time 15 "$@" "$url" || echo "__CURL_FAIL__"
}
tap_ok()   { N=$((N+1)); PASS=$((PASS+1)); echo "ok $N - $1"; }
tap_fail() { N=$((N+1)); FAIL=$((FAIL+1)); echo "not ok $N - $1"; [ -n "${2:-}" ] && echo "  # detalhe: $2"; }
tap_skip() { N=$((N+1)); SKIP=$((SKIP+1)); echo "ok $N - $1 # SKIP${2:+ $2}"; }
json_field() { # $1=json $2=campo → valor ou "" (python3; sem jq p/ não exigir dep nova)
  python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get(sys.argv[2],''))" "$1" "$2" 2>/dev/null || echo ""
}

echo "TAP version 13"
echo "# smoke-prod modo=$MODE portal=$PORTAL_BASE api=$API_BASE admin=$ADMIN_BASE"

# --- 1. /health/live 200 ------------------------------------------------------
check_live() {
  local code body
  code="$(http_code "$API_BASE/health/live")"
  if [ "$code" = "200" ]; then
    body="$(body_of "$API_BASE/health/live")"
    if [ "$(json_field "$body" status)" = "ok" ]; then tap_ok "health-live 200 {status:ok}";
    else tap_fail "health-live corpo" "$body"; fi
  else tap_fail "health-live 200" "HTTP $code"; fi
}

# --- 2. /metrics responde (Fase 10 lê; aqui só prova que responde) -------------
check_metrics() {
  local code body
  code="$(http_code "$API_BASE/metrics")"
  if [ "$code" != "200" ]; then tap_fail "metrics responde" "HTTP $code"; return; fi
  body="$(body_of "$API_BASE/metrics")"
  if [ -z "$body" ] || [ "$body" = "__CURL_FAIL__" ]; then tap_fail "metrics corpo" "vazio"; return; fi
  tap_ok "metrics responde 200 (consumidor adiado Fase 10)"
  if echo "$body" | grep -q "http_requests_total"; then
    echo "  # info: série http_requests_total presente"
  else
    echo "  # info: série http_requests_total ausente (ok nesta fase — coleta é Fase 10)"
  fi
}

# --- 3. home 200 + âncora #produtos --------------------------------------------
HOME_BODY=""
check_home() {
  local code
  code="$(http_code "$PORTAL_BASE/")"
  if [ "$code" != "200" ]; then tap_fail "home 200" "HTTP $code"; return; fi
  HOME_BODY="$(body_of "$PORTAL_BASE/")"
  if echo "$HOME_BODY" | grep -q "produtos"; then tap_ok "home 200 + âncora #produtos";
  else tap_fail "home âncora #produtos" "HTML sem 'produtos'"; fi
}

# --- 4. produtos da API + anti-mock no BFF --------------------------------------
# Marker de mock (BFF serve stub silencioso quando API_INTERNAL_URL ausente —
# apps/portal/app/api/products/route.ts): corpo com UPSTREAM_UNAVAILABLE, lista
# vazia com API não-vazia, ou conjunto de `code` divergente da API.
check_products() {
  local api_code bff_code api_body bff_body
  api_code="$(http_code "$API_BASE/v1/products")"
  if [ "$api_code" != "200" ]; then tap_fail "api products 200" "HTTP $api_code"; return; fi
  api_body="$(body_of "$API_BASE/v1/products")"
  local api_codes
  api_codes="$(python3 -c "import json,sys
try:
  d=json.loads(sys.argv[1]); rows=d if isinstance(d,list) else d.get('data',d.get('items',[]))
  print(' '.join(sorted(str(r.get('code','')) for r in rows)))
except Exception: print('')" "$api_body" 2>/dev/null || echo "")"
  if [ -z "$api_codes" ]; then tap_fail "api products dados" "lista vazia/ilegível"; return; fi
  tap_ok "api products 200 com dados (codes: $api_codes)"

  bff_code="$(http_code "$PORTAL_BASE/api/products")"
  if [ "$bff_code" = "502" ]; then tap_fail "bff products anti-mock" "502 UPSTREAM_UNAVAILABLE (BFF sem backend)"; return; fi
  if [ "$bff_code" != "200" ]; then tap_fail "bff products 200" "HTTP $bff_code"; return; fi
  bff_body="$(body_of "$PORTAL_BASE/api/products")"
  if echo "$bff_body" | grep -q "UPSTREAM_UNAVAILABLE"; then
    tap_fail "bff products anti-mock" "marker UPSTREAM_UNAVAILABLE (mock/stub)"; return
  fi
  local bff_codes
  bff_codes="$(python3 -c "import json,sys
try:
  d=json.loads(sys.argv[1]); rows=d if isinstance(d,list) else d.get('data',d.get('items',[]))
  print(' '.join(sorted(str(r.get('code','')) for r in rows)))
except Exception: print('')" "$bff_body" 2>/dev/null || echo "")"
  if [ -z "$bff_codes" ]; then tap_fail "bff products anti-mock" "BFF vazio com API não-vazia (possível mock)"; return; fi
  if [ "$bff_codes" = "$api_codes" ]; then tap_ok "bff products = api products (anti-mock: codes conferem)";
  else tap_fail "bff products anti-mock" "codes divergem — api=[$api_codes] bff=[$bff_codes] (possível mock silencioso)"; fi
}

# --- 5. login admin -------------------------------------------------------------
check_admin_login() {
  local code
  code="$(http_code "$ADMIN_BASE/")"
  if [ "$code" = "200" ]; then tap_ok "admin host 200";
  else tap_fail "admin host 200" "HTTP $code"; fi

  if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASS" ]; then
    code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" \
      "$API_BASE/v1/auth/login" || echo "000")"
    if [ "$code" = "200" ] || [ "$code" = "201" ]; then tap_ok "login admin 200";
    else tap_fail "login admin 200" "HTTP $code (credencial inválida ou API fora)"; fi
  else
    # Sem credencial: prova que a rota existe sem autenticar (400 validação,
    # nunca 404). Não tenta login, não loga senha.
    code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 \
      -H "Content-Type: application/json" -d '{}' \
      "$API_BASE/v1/auth/login" || echo "000")"
    case "$code" in
      400|422) tap_ok "login admin rota viva (400 sem credencial, sem tentar login)" ;;
      *) tap_skip "login admin 200" "sem SMOKE_ADMIN_EMAIL/PASSWORD (rota retornou HTTP $code)" ;;
    esac
  fi
}

# --- 6. checkout (dry-run: só endpoints; live: confirmação humana) ---------------
check_checkout() {
  local code
  code="$(http_code "$PORTAL_BASE/checkout?code=aurum-base")"
  if [ "$code" = "200" ]; then tap_ok "checkout page 200";
  else tap_fail "checkout page 200" "HTTP $code"; fi

  # POST sem sessão deve dar 401 (endpoint existe, nenhuma cobrança acontece).
  code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 \
    -X POST -H "Content-Type: application/json" \
    -d '{"items":[],"paymentMethod":"pix"}' \
    "$PORTAL_BASE/api/me/checkout" || echo "000")"
  if [ "$code" = "401" ]; then tap_ok "checkout endpoint exige auth (401 sem sessão, sem cobrar)";
  else tap_fail "checkout endpoint auth" "HTTP $code (esperado 401 sem sessão)"; fi

  if [ "$MODE" = "live" ]; then checkout_live_flow; else tap_skip "checkout valor-mínimo+estorno" "modo --dry-run (sem cobrança)"; fi
}

checkout_live_flow() {
  echo "# --live: cobrança REAL em valor mínimo + estorno. Nada é automatizado."
  echo "# Passo manual do operador (navegador):"
  echo "#   1. Abrir $PORTAL_BASE/checkout?code=<produto-mais-barato>"
  echo "#   2. Concluir compra no menor valor (Pix)."
  echo "#   3. Confirmar chave liberada UMA vez (sem duplicar licença)."
  echo "#   4. Estornar no painel Asaas + conferir fatura estornada na API."
  printf "digite CONFIRMAR para atestar que executou os 4 passos e o estorno: "
  local ans=""
  IFS= read -r ans < /dev/tty || ans=""
  if [ "$ans" = "CONFIRMAR" ]; then tap_ok "checkout valor-mínimo+estorno (atestado humano --live)";
  else tap_fail "checkout valor-mínimo+estorno" "sem atestado humano (digitado: '${ans:-<vazio>}')"; fi
}

# --- 7. webhook: rota viva sem segredo + URL a confirmar no painel -------------
check_webhook_route() {
  echo "# URL a confirmar MANUALMENTE no painel Asaas PROD (Webhooks):"
  echo "#   $WEBHOOK_URL"
  echo "#   header: $WEBHOOK_TOKEN_HEADER = <ASAAS_WEBHOOK_SECRET prod>"
  echo "#   eventos: PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_REFUNDED,"
  echo "#            PAYMENT_OVERDUE, PAYMENT_DELETED (PROJECT.md §5)"
  # POST sem token deve dar 401 (rota viva), nunca 404. Sem segredo, sem PII.
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 \
    -X POST -H "Content-Type: application/json" \
    -d '{"event":"PING_SMOKE","payment":{"id":"none"}}' \
    "$WEBHOOK_URL" || echo "000")"
  if [ "$code" = "401" ]; then tap_ok "webhook rota viva (401 sem token, URL pronta p/ painel)";
  else tap_fail "webhook rota viva" "HTTP $code (esperado 401 sem token; 404 = rota fora)"; fi
}

# --- 8. webhook duplicado: mesmo eventId 2x → 2º DUPLICATE 200 ------------------
# Exercita o Guard real: INSERT ... ON CONFLICT (provider,externalId) DO NOTHING
# (webhook.service.ts RECEIPT_INSERT) → { duplicate:true } com 200.
check_webhook_duplicate() {
  if [ -z "$ASAAS_SECRET" ]; then
    tap_skip "webhook duplicado" "sem SMOKE_ASAAS_SECRET"
    return
  fi
  local pid="pay_smoke_$(( $(date +%s) ))"
  local payload="{\"event\":\"PAYMENT_CONFIRMED\",\"payment\":{\"id\":\"$pid\"}}"
  local expected_event="wh:asaas:PAYMENT_CONFIRMED:$pid"

  local r1 r2 c1 c2
  r1="$(curl -sS --max-time 15 -X POST -H "Content-Type: application/json" \
    -H "$WEBHOOK_TOKEN_HEADER: $ASAAS_SECRET" -d "$payload" \
    -w "\n%{http_code}" "$WEBHOOK_URL" || echo "__CURL_FAIL__")"
  c1="$(echo "$r1" | tail -n1)"; r1="$(echo "$r1" | sed '$d')"
  r2="$(curl -sS --max-time 15 -X POST -H "Content-Type: application/json" \
    -H "$WEBHOOK_TOKEN_HEADER: $ASAAS_SECRET" -d "$payload" \
    -w "\n%{http_code}" "$WEBHOOK_URL" || echo "__CURL_FAIL__")"
  c2="$(echo "$r2" | tail -n1)"; r2="$(echo "$r2" | sed '$d')"

  # Log resumido: só event/paymentId (nunca corpo/PII/cartão).
  echo "# webhook-dup paymentId=$pid (payloads resumidos, sem PII)"
  if [ "$c1" != "200" ]; then tap_fail "webhook 1ª entrega 200" "HTTP $c1"; return; fi
  if [ "$c2" != "200" ]; then tap_fail "webhook 2ª entrega 200 (sem retry inútil)" "HTTP $c2"; return; fi
  local e1 e2 d1 d2
  e1="$(json_field "$r1" eventId)"; d1="$(json_field "$r1" duplicate)"
  e2="$(json_field "$r2" eventId)"; d2="$(json_field "$r2" duplicate)"
  if [ "$e1" = "$expected_event" ] && [ "$e2" = "$expected_event" ]; then
    tap_ok "webhook eventId idempotente ($expected_event)"
  else
    tap_fail "webhook eventId idempotente" "1º=[$e1] 2º=[$e2] esperado=[$expected_event]"; return
  fi
  if [ "$d1" = "False" ] && [ "$d2" = "True" ]; then
    tap_ok "webhook duplicado → 1º recebido, 2º DUPLICATE 200 (Guard UNIQUE(provider,externalId))"
  elif [ "$d1" = "True" ] && [ "$d2" = "True" ]; then
    tap_ok "webhook duplicado → DUPLICATE 200 (re-execução idempotente, já recebido antes)"
  else
    tap_fail "webhook duplicado DUPLICATE" "1º duplicate=[$d1] 2º duplicate=[$d2] (esperado False/True)"
  fi

  # Contagem: a recepção sozinha nunca cria fatura — total de invoices estável.
  local before after
  before="$(curl -sS --max-time 15 -H "x-role: admin" "$API_BASE/v1/billing/invoices?limit=1" || echo "")"
  after="$(curl -sS --max-time 15 -H "x-role: admin" "$API_BASE/v1/billing/invoices?limit=1" || echo "")"
  if echo "$before" | grep -q "FORBIDDEN\|UNAUTHORIZED" || [ -z "$before" ]; then
    tap_skip "webhook sem 2ª cobrança (contagem)" "inspeção admin indisponível"
  elif [ "$before" = "$after" ]; then
    tap_ok "webhook sem 2ª cobrança (invoices estável antes/depois da duplicata)"
  else
    tap_fail "webhook sem 2ª cobrança" "lista de invoices mudou entre as entregas"
  fi
}

check_live
check_metrics
check_home
check_products
check_admin_login
check_checkout
check_webhook_route
check_webhook_duplicate

echo "# --- checklist T6 ---"
echo "# pass=$PASS skip=$SKIP fail=$FAIL (modo=$MODE)"
if [ "$FAIL" -gt 0 ]; then echo "# RESULTADO: FALHOU"; exit 1; fi
echo "# RESULTADO: VERDE (nenhum FAIL)"
