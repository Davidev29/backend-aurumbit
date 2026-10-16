#!/usr/bin/env bash
# tag-images.sh — congela as imagens locais em tags por git SHA (rollback T1).
# Uso (na VPS ou CI, após `docker compose build` / `up --build`):
#   bash deploy/scripts/tag-images.sh            # tag + lista retenção
#   KEEP=5 PRUNE=1 bash deploy/scripts/tag-images.sh  # + poda excedente
# Nunca faz push (registro externo fica p/ fase posterior, se houver).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# api usa o nome canônico pedido pelo dono: imagem `aurum_bit_backend:local`.
# workers/admin/portal mantêm `aurum-<svc>:local`.
SERVICES="workers admin portal"
API_IMAGE="aurum_bit_backend"
KEEP="${KEEP:-5}"

# SHA curto do commit atual; fail-closed sem repo git (nada de tag inventada).
SHA="${GIT_SHA:-$(git -C "$ROOT" rev-parse --short HEAD)}"
echo "tag-images: SHA=$SHA KEEP=$KEEP"

# API primeiro (nome canônico Aurum_Bit_Backend -> imagem aurum_bit_backend).
if ! docker image inspect "${API_IMAGE}:local" >/dev/null 2>&1; then
  echo "ERRO: imagem ${API_IMAGE}:local ausente (rode o build antes)" >&2
  exit 1
fi
docker tag "${API_IMAGE}:local" "${API_IMAGE}:${SHA}"
echo "tag ok: ${API_IMAGE}:${SHA}"

for svc in $SERVICES; do
  if ! docker image inspect "aurum-${svc}:local" >/dev/null 2>&1; then
    echo "ERRO: imagem aurum-${svc}:local ausente (rode o build antes)" >&2
    exit 1
  fi
  docker tag "aurum-${svc}:local" "aurum-${svc}:${SHA}"
  echo "tag ok: aurum-${svc}:${SHA}"
done

echo "--- retenção (aurum) ---"
docker images | grep aurum || echo "(nenhuma imagem aurum)"

# Poda opt-in: mantém `:local`, a tag em uso e as KEEP mais recentes por serviço.
if [ "${PRUNE:-0}" = "1" ]; then
  for svc in $SERVICES; do
    # Lista tags por data de criação (mais novas primeiro), pula cabeçalho implícito.
    mapfile -t tags < <(docker images --format '{{.Repository}} {{.Tag}} {{.CreatedAt}}' \
      | awk -v r="aurum-${svc}" '$1==r && $2!="local" {print $2" "$3" "$4" "$5}' \
      | sort -k2 -r | awk '{print $1}')
    i=0
    for t in "${tags[@]:-}"; do
      i=$((i + 1))
      if [ "$i" -gt "$KEEP" ]; then
        # Nunca remove a tag do SHA atual (pode estar em uso no compose).
        if [ "$t" != "$SHA" ]; then
          docker rmi "aurum-${svc}:${t}" || echo "aviso: não removeu aurum-${svc}:${t}"
        fi
      fi
    done
  done
  # Poda também a imagem canônica da api (aurum_bit_backend).
  mapfile -t api_tags < <(docker images --format '{{.Repository}} {{.Tag}} {{.CreatedAt}}' \
    | awk -v r="${API_IMAGE}" '$1==r && $2!="local" {print $2" "$3" "$4" "$5}' \
    | sort -k2 -r | awk '{print $1}')
  i=0
  for t in "${api_tags[@]:-}"; do
    i=$((i + 1))
    if [ "$i" -gt "$KEEP" ]; then
      if [ "$t" != "$SHA" ]; then
        docker rmi "${API_IMAGE}:${t}" || echo "aviso: não removeu ${API_IMAGE}:${t}"
      fi
    fi
  done
  echo "--- após poda ---"
  docker images | grep aurum || echo "(nenhuma imagem aurum)"
fi
