#!/usr/bin/env bash
# deploy/scripts/disk-check.sh — checagem de disco pronta p/ cron (Fase 7, T1/T7).
# Imprime `df -h` + `docker system df` e alerta se qualquer filesystem
# passar de DISK_WARN_PCT (default 80): exit 2 = WARN, exit 0 = OK, exit 1 = erro.
# Leitura pura: nunca deleta nada (limpeza é decisão humana, ver RUNBOOK deploy §8).
set -euo pipefail

WARN="${DISK_WARN_PCT:-80}"

echo "=== disk-check (limite WARN=${WARN}%) ==="
echo "--- df -h ---"
df -h

if command -v docker >/dev/null 2>&1; then
  echo "--- docker system df ---"
  docker system df || echo "[warn] docker system df falhou (daemon fora?)"
else
  echo "[info] docker ausente — pule docker system df"
fi

# Parse portátil (df -P): coluna 5 = uso%, coluna 6 = mount.
OVER=0
while read -r _fs _size _used _avail pct mount; do
  case "$_fs" in Filesystem|fuse-overlayfs) continue ;; esac
  num="${pct%\%}"
  case "$num" in ''|*[!0-9]*) continue ;; esac
  if [ "$num" -gt "$WARN" ]; then
    echo "[WARN] $mount em ${pct} (> ${WARN}%) — agir antes de lotar (Postgres cai feio com disco cheio)"
    OVER=1
  fi
done <<EOF
$(df -P --exclude-type=tmpfs --exclude-type=devtmpfs --exclude-type=overlay 2>/dev/null || df -P)
EOF

if [ "$OVER" = "1" ]; then
  echo "=== disk-check WARN (exit 2) ==="
  exit 2
fi
echo "=== disk-check OK (tudo <= ${WARN}%) ==="
