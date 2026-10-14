#!/usr/bin/env bash
# deploy/scripts/harden-vps.sh — Hardening idempotente da VPS (Fase 7, T7).
#
# DEFAULT = --dry-run: só imprime o que faria, SEM mutação.
# --apply: executa de verdade. Exige root E env ALLOW_SSH_KEY=<fingerprint>
# como confirmação de que você tem acesso por chave. O script NUNCA
# desabilita senha sem essas duas condições (travar-se fora do SSH é
# irreversível sem console da provedora).
#
# Cobre: ufw (só 22/80/443), sshd só chave, unattended-upgrades,
# chrony/NTP, vm.swappiness, checagem de disco.
# fail2ban é opcional: só com WITH_FAIL2BAN=1.
set -euo pipefail

MODE="dry-run"
for arg in "$@"; do
  case "$arg" in
    --apply) MODE="apply" ;;
    --dry-run) MODE="dry-run" ;;
    -h|--help)
      echo "Uso: $0 [--dry-run] [--apply]"
      echo "  (default) --dry-run: só imprime, sem mutação."
      echo "  --apply: exige root + env ALLOW_SSH_KEY=<fp da sua chave ssh>."
      echo "  Opcional: WITH_FAIL2BAN=1 inclui fail2ban no apply."
      exit 0 ;;
    *) echo "arg desconhecido: $arg (use --help)" >&2; exit 1 ;;
  esac
done

DRY_RUN=1
[ "$MODE" = "apply" ] && DRY_RUN=0

# Imprime no dry-run; executa no apply.
run_sh() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] $1"
  else
    echo "[apply] $1"
    bash -c "$1"
  fi
}

echo "=== harden-vps.sh modo=$MODE ==="

# --- 0. Trava de segurança do SSH (só no apply) ---
if [ "$DRY_RUN" = "0" ]; then
  [ "$(id -u)" = "0" ] || { echo "FAIL: --apply exige root" >&2; exit 1; }
  [ -n "${ALLOW_SSH_KEY:-}" ] || {
    echo "FAIL: --apply exige ALLOW_SSH_KEY=<fingerprint> (confirmação de acesso por chave)" >&2
    exit 1
  }
  KEYFILES="/root/.ssh/authorized_keys"
  [ -n "${SUDO_USER:-}" ] && KEYFILES="$KEYFILES /home/$SUDO_USER/.ssh/authorized_keys"
  FOUND=0
  for kf in $KEYFILES; do
    if [ -s "$kf" ]; then echo "[ok] chave presente: $kf"; FOUND=1; fi
  done
  [ "$FOUND" = "1" ] || { echo "FAIL: nenhum authorized_keys não-vazio; abortando (sem chave = sem SSH)" >&2; exit 1; }
  if command -v ssh-keygen >/dev/null 2>&1; then
    echo "[info] fingerprints instalados (confira contra ALLOW_SSH_KEY=$ALLOW_SSH_KEY):"
    for kf in $KEYFILES; do [ -f "$kf" ] && ssh-keygen -lf "$kf" || true; done
  fi
else
  echo "[dry-run] checagens de apply (root, ALLOW_SSH_KEY, authorized_keys) seriam validadas aqui"
fi

# --- 1. ufw: só 22/80/443 (idempotente: confere antes de adicionar) ---
if [ "$DRY_RUN" = "1" ]; then
  run_sh "ufw default deny incoming"
  run_sh "ufw default allow outgoing"
  for p in 22/tcp 80/tcp 443/tcp; do run_sh "ufw allow $p"; done
  run_sh "ufw --force enable"
  run_sh "ufw status verbose"
else
  ufw default deny incoming
  ufw default allow outgoing
  for p in 22/tcp 80/tcp 443/tcp; do
    if ufw status 2>/dev/null | grep -q "$p.*ALLOW"; then
      echo "[ok] ufw já libera $p"
    else
      echo "[apply] ufw allow $p"; ufw allow "$p"
    fi
  done
  echo "[apply] ufw --force enable"; ufw --force enable
  ufw status verbose
fi

# --- 2. sshd: só chave (backup .bak uma vez; valida com sshd -t) ---
SSHD=/etc/ssh/sshd_config
if [ "$DRY_RUN" = "1" ]; then
  run_sh "cp -n $SSHD $SSHD.bak"
  run_sh "sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' $SSHD"
  run_sh "sed -i 's/^#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' $SSHD"
  run_sh "sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' $SSHD"
  run_sh "sshd -t && systemctl reload sshd"
else
  [ -f "$SSHD.bak" ] || { echo "[apply] cp $SSHD $SSHD.bak"; cp "$SSHD" "$SSHD.bak"; }
  for kv in "PasswordAuthentication no" "ChallengeResponseAuthentication no" "PermitRootLogin prohibit-password"; do
    k="${kv%% *}"
    if grep -qx "$kv" "$SSHD"; then
      echo "[ok] sshd já tem: $kv"
    else
      echo "[apply] sshd: $kv"
      if grep -q "^#*$k" "$SSHD"; then
        sed -i "s/^#*$k.*/$kv/" "$SSHD"
      else
        echo "$kv" >> "$SSHD"
      fi
    fi
  done
  echo "[apply] sshd -t && systemctl reload sshd"
  sshd -t && systemctl reload sshd
fi

# --- 3. unattended-upgrades (apt é idempotente por natureza) ---
run_sh "apt-get update"
if [ "$DRY_RUN" = "1" ]; then
  run_sh "apt-get install -y unattended-upgrades"
  run_sh "printf 'APT::Periodic::Update-Package-Lists \"1\";\nAPT::Periodic::Unattended-Upgrade \"1\";\n' > /etc/apt/apt.conf.d/20auto-upgrades"
else
  echo "[apply] apt-get install -y unattended-upgrades"
  apt-get install -y unattended-upgrades
  CONF=/etc/apt/apt.conf.d/20auto-upgrades
  grep -q 'Unattended-Upgrade "1"' "$CONF" 2>/dev/null \
    && echo "[ok] unattended-upgrades já agendado" \
    || { echo "[apply] agenda upgrades em $CONF";
         printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > "$CONF"; }
fi

# --- 4. NTP/chrony (billing e webhooks sofrem com clock skew) ---
run_sh "apt-get install -y chrony"
if [ "$DRY_RUN" = "0" ]; then
  echo "[apply] systemctl enable --now chrony"; systemctl enable --now chrony
fi
run_sh "timedatectl set-ntp true"
run_sh "timedatectl status"
run_sh "chronyc tracking"

# --- 5. vm.swappiness (idempotente: só escreve se divergir) ---
SWAP_CONF=/etc/sysctl.d/99-aurum.conf
if [ "$DRY_RUN" = "1" ]; then
  run_sh "echo 'vm.swappiness=10' > $SWAP_CONF && sysctl -p $SWAP_CONF"
else
  if grep -qx "vm.swappiness=10" "$SWAP_CONF" 2>/dev/null; then
    echo "[ok] vm.swappiness já = 10"
  else
    echo "[apply] vm.swappiness=10 em $SWAP_CONF"
    echo "vm.swappiness=10" > "$SWAP_CONF"
    sysctl -p "$SWAP_CONF"
  fi
fi

# --- 6. fail2ban (OPCIONAL) ---
if [ "${WITH_FAIL2BAN:-0}" = "1" ]; then
  run_sh "apt-get install -y fail2ban"
  if [ "$DRY_RUN" = "0" ]; then
    echo "[apply] systemctl enable --now fail2ban"; systemctl enable --now fail2ban
  fi
  run_sh "fail2ban-client status sshd"
else
  echo "[skip] fail2ban opcional (ative com WITH_FAIL2BAN=1)"
fi

# --- 7. Disco: df + delega ao disk-check.sh ---
run_sh "df -h / /var/lib/docker"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -x "$SCRIPT_DIR/disk-check.sh" ]; then
  run_sh "$SCRIPT_DIR/disk-check.sh"
else
  echo "[info] disk-check.sh ainda não instalado ao lado deste script — pule"
fi

echo "=== harden-vps.sh modo=$MODE concluído ==="
echo "Pós-apply obrigatório: timedatectl | grep -i 'synchronized: yes' && ufw status verbose"
