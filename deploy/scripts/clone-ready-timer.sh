#!/usr/bin/env bash
# clone-ready-timer.sh — T8 Fase 7 (pendência PHASE-1-REPORT:26).
# Mede o tempo de um clone fresco até `GET /health/ready → 200`.
# Veredito: total <10min (600s) = PASS; >=10min ou erro = FAIL.
#
# Uso:
#   bash deploy/scripts/clone-ready-timer.sh [--repo <url>] [--branch <n>]
#       [--dir <path>] [--local] [--timeout <s>] [--keep] [--dry-run] [--help]
#
# Nunca deixa container órfão: ao sair, derruba o compose salvo com --keep.
# Sem Docker no host (ex. Windows): use --local --dry-run (simulação).
set -euo pipefail

BUDGET=600 # 10min, gate da Fase 7
REPO=""
BRANCH=""
WORKDIR=""
LOCAL=0
TIMEOUT="$BUDGET"
KEEP=0
DRY_RUN=0
API_PORT="${API_PORT:-3000}"

usage() {
  sed -n '2,10p' "$0"
  echo ""
  echo "Opções:"
  echo "  --repo <url>   repo a clonar (default: remote.origin.url do cwd)"
  echo "  --branch <n>   branch a clonar (default: default do remoto)"
  echo "  --dir <path>   destino do clone (default: temp clone-ready-XXXXXX)"
  echo "  --local        mede sem clonar (usa o cwd; útil sem Docker/Windows)"
  echo "  --timeout <s>  orçamento total em segundos (default: 600)"
  echo "  --keep         não derruba os containers ao sair"
  echo "  --dry-run      simula o cronômetro (sem docker/git; sempre verde p/ teste)"
  echo "  --help         esta ajuda"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:?--repo exige <url>}"; shift 2 ;;
    --branch) BRANCH="${2:?--branch exige <nome>}"; shift 2 ;;
    --dir) WORKDIR="${2:?--dir exige <path>}"; shift 2 ;;
    --local) LOCAL=1; shift ;;
    --timeout) TIMEOUT="${2:?--timeout exige <s>}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "flag desconhecida: $1 (ver --help)" >&2; exit 2 ;;
  esac
done

T0="$(date +%s)"
STAGES="" # "nome=seg ..." acumulado p/ o relatório final

fmt() { # fmt <seg> → "MM:SS"
  printf "%02d:%02d" "$(( $1 / 60 ))" "$(( $1 % 60 ))"
}

stamp() { # stamp <nome> <inicio> → imprime etapa e acumula
  local now dur
  now="$(date +%s)"
  dur=$(( now - $2 ))
  STAGES="${STAGES}$1=${dur}s "
  echo "[timer] etapa $1: ${dur}s (acumulado: $(fmt $(( now - T0 ))))"
}

verdict() { # verdict → 0 PASS / 1 FAIL, sempre imprime o cronômetro
  local total="$(( $(date +%s) - T0 ))"
  echo "[timer] ${STAGES}total=${total}s ($(fmt "$total")) budget=${BUDGET}s"
  if [ "$total" -lt "$BUDGET" ]; then
    echo "[timer] veredito: <10min PASS"
    return 0
  fi
  echo "[timer] veredito: >=10min FAIL"
  return 1
}

fail() { # fail <etapa> <msg> → cronômetro parcial + FAIL
  echo "[timer] FAIL em '$1': $2" >&2
  verdict || true
  exit 1
}

# --- Simulação (sem docker/git; valida o cronômetro em qualquer host) ---
if [ "$DRY_RUN" = "1" ]; then
  echo "[timer] dry-run: cronômetro simulado (nenhum container/rede tocado)"
  for s in "clone=12" "build=178" "migrate=44" "seed=9" "ready=62"; do
    echo "[timer] etapa ${s%%=*}: ${s##*=}s (simulado)"
    STAGES="${STAGES}${s%%=*}=${s##*=}s "
  done
  # Recalcula T0 p/ o total simulado = 305s (<10min → PASS).
  T0="$(( $(date +%s) - 305 ))"
  verdict
  exit $?
fi

# --- Origem do código ---
if [ "$LOCAL" = "1" ]; then
  ROOT="$(pwd)"
  [ -f "$ROOT/deploy/docker-compose.yml" ] || fail "local" "cwd sem deploy/docker-compose.yml: $ROOT"
  echo "[timer] modo --local: mede sem clonar em $ROOT"
else
  if [ -z "$REPO" ]; then
    REPO="$(git config --get remote.origin.url 2>/dev/null || true)"
    [ -n "$REPO" ] || fail "clone" "sem --repo e sem remote.origin.url no cwd (ou use --local)"
  fi
  if [ -z "$WORKDIR" ]; then
    WORKDIR="$(mktemp -d -t clone-ready-XXXXXX 2>/dev/null || mktemp -d)"
  else
    mkdir -p "$WORKDIR"
  fi
  ROOT="$WORKDIR"
  echo "[timer] clonando $REPO → $WORKDIR"
  S="$(date +%s)"
  if [ -n "$BRANCH" ]; then
    git clone --branch "$BRANCH" --depth 1 "$REPO" "$WORKDIR" || fail "clone" "git clone falhou"
  else
    git clone --depth 1 "$REPO" "$WORKDIR" || fail "clone" "git clone falhou"
  fi
  stamp "clone" "$S"
fi

cd "$ROOT"

# --- Subida (teardown garantido salvo --keep) ---
cleanup() {
  if [ "$KEEP" = "0" ]; then
    echo "[timer] derrubando compose (sem --keep, sem órfãos)"
    docker compose -f deploy/docker-compose.yml down -v >/dev/null 2>&1 || true
  else
    echo "[timer] --keep: containers mantidos em $ROOT"
  fi
}
trap cleanup EXIT

[ -f .env ] || { cp .env.example .env && echo "[timer] .env criado de .env.example (segredos: defaults locais)"; }

S="$(date +%s)"
docker compose -f deploy/docker-compose.yml up -d --build || fail "build" "compose up falhou"
stamp "build" "$S"

S="$(date +%s)"
bash deploy/scripts/migrate-all.sh || fail "migrate" "migrate-all.sh falhou"
stamp "migrate" "$S"

S="$(date +%s)"
bash deploy/scripts/seed-all.sh || fail "seed" "seed-all.sh falhou"
stamp "seed" "$S"

# --- Espera live → ready com deadline = orçamento restante ---
S="$(date +%s)"
DEADLINE=$(( T0 + TIMEOUT ))
BASE="http://localhost:${API_PORT}"
echo "[timer] aguardando $BASE/health/live + /health/ready (deadline: $(fmt "$TIMEOUT"))"
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if curl -fsS "$BASE/health/live" >/dev/null 2>&1 \
    && curl -fsS "$BASE/health/ready" 2>/dev/null | grep -q '"status":"ok"'; then
    stamp "ready" "$S"
    verdict
    exit $?
  fi
  sleep 5
done
docker compose -f deploy/docker-compose.yml logs --tail=100 >&2 || true
fail "ready" "deadline ${TIMEOUT}s sem live+ready 200 em $BASE"
